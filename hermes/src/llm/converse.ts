import { commandAllowed } from "../telegram/access.js";
import { assertUnderCostCap, computeCost, recordCostUsd, CostCapError } from "../lib/cost.js";
import { trackDrain } from "../lib/shutdown.js";
import { type Locale } from "../lib/i18n.js";
import { chat, ProviderNotConfiguredError, type ChatMessage } from "./provider.js";
import { scrubText } from "./redact.js";
import { specsForRole } from "./tool-catalog.js";
import { runTool } from "./tools.js";

/**
 * One conversational turn.
 *
 * Until now a message that was not a slash command got the command list back —
 * correct, and completely unhelpful to someone who typed "сколько мы должны
 * девочкам?". This is the path that answers instead.
 *
 * The shape mirrors the app's agent loop (`src/lib/ai/agent.ts`) deliberately,
 * because that loop is the reviewed one: scrub the human's text, call the
 * provider with tool definitions, execute a requested tool, redact its rows,
 * feed them back, repeat to a hard round cap, then answer. What differs is
 * WHAT the tools can reach — see `tools.ts`: exactly the readers the slash
 * commands already use, nothing wider.
 *
 * Four things bound this turn:
 *   1. COST — `assertUnderCostCap()` before the first call, a per-turn ceiling
 *      between rounds, and ONE accumulated write at the end (off the critical
 *      path, drain-tracked). This is what makes `lib/cost.ts` load-bearing:
 *      before the worker made provider calls the cap was unthrowable and
 *      `/cost` always read $0.
 *   2. EGRESS — the person's message is scrubbed by the app's real redactor
 *      before it leaves, and every tool result is projected by it. There is no
 *      other serialization path from here to a provider.
 *   3. TIME — a hard round cap AND a whole-turn deadline; a model that keeps
 *      calling tools is cut off and answers with what it has.
 *   4. ROLE — tools are offered per role and re-checked at execution.
 *
 * MEMORY lives one layer up, not here. This function is given whatever prior
 * turns should be replayed (`input.history`) and returns an answer; the
 * caller — `telegram/handler.ts` — is what loads the chat's state, decides
 * whether the thread has gone idle, and writes the exchange back through
 * `hermes_session_append` (028). Keeping the turn itself stateless is what
 * lets it be exercised without a database.
 *
 * The owner chose to keep that history indefinitely (027), so both sides are
 * stored SCRUBBED: state is replayed straight back into the next provider
 * call, and raw text there would egress on turn 2 exactly what turn 1 masked.
 */

const MAX_ROUNDS = 4;
const MAX_REPLY_CHARS = 3500;

/**
 * A whole-turn ceiling, distinct from the per-request one in `provider.ts`.
 * 45s per request across up to 5 requests allowed a turn to run ~225 seconds.
 * Nobody waits that long on Telegram; past this the turn is abandoned and the
 * person is told, which beats holding a slot in silence.
 */
const TURN_DEADLINE_MS = 60_000;

/**
 * A per-turn spend ceiling. `assertUnderCostCap()` runs once, at the start, so
 * a single turn could previously make five provider calls with no budget check
 * between them — the daily cap only noticed on the NEXT turn. Batching the
 * cost write made that gap explicit, so it is closed here.
 */
const TURN_COST_CAP_USD = 0.1;

/** Domain rules. English in both locales, for the reason the app's agent gives:
 * the tool descriptions are English, and a model maps a Russian question onto
 * that vocabulary far more reliably than onto a translated paraphrase. */
const DOMAIN_RULES = [
  "You are Hermes, the Freedom Studio's assistant, talking to a member of staff on Telegram.",
  "The studio manages webcam models: it tracks their earnings, hours, payouts and compliance documents.",
  "Answer using ONLY the tools provided. Never invent a figure, a name, or a date.",
  "If no tool can answer, say what you do know and name the command or screen that would.",
  "Tool results are already de-identified aggregates. Refer to people by the names they contain.",
  "Be brief and conversational — this is a chat, not a report. Two or three sentences is usually right.",
  "Never use Markdown or HTML formatting; Telegram shows this message as plain text.",
  "Money is USD unless a row says otherwise.",
].join(" ");

const LANGUAGE_CLAUSE: Record<Locale, string> = {
  en: "Always answer in English, whatever language the question was asked in.",
  ru: [
    "Отвечай ТОЛЬКО по-русски, на каком бы языке ни был задан вопрос.",
    "Always answer in Russian, never in English.",
    "Имена, названия площадок и категорий из результатов инструментов приводи как есть.",
  ].join(" "),
};

function systemPrompt(locale: Locale, role: string): string {
  return [
    DOMAIN_RULES,
    LANGUAGE_CLAUSE[locale],
    `The person you are talking to has the role "${role}".`,
    "Tools they may not use are not offered to you; do not describe data you cannot fetch.",
  ].join(" ");
}

export type ConverseOutcome =
  | { kind: "answered"; text: string }
  | { kind: "not_configured" }
  | { kind: "over_cap" }
  | { kind: "failed"; error: string };

/** What the turn is doing right now, so a caller can show its work. */
export type ConverseStage = { kind: "thinking" } | { kind: "tools"; names: string[] };

export async function converse(input: {
  text: string;
  role: string;
  locale: Locale;
  profileId: string;
  /** Where to put an approval card, when a tool proposes one. */
  chatId: number | string;
  /** Prior turns to replay. Already scrubbed; never contains tool stubs. */
  history?: ChatMessage[];
  onProgress?: (stage: ConverseStage) => void;
}): Promise<ConverseOutcome> {
  const startedAt = Date.now();
  const specs = specsForRole(input.role, commandAllowed);

  // The human's own words are the one free text that crosses. Scrubbed by the
  // app's real redactor: emails, phone numbers and card-like strings masked
  // before they can leave, exactly as the app does for chat input.
  const asked = scrubText(input.text).slice(0, 2000);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.locale, input.role) },
    ...(input.history ?? []),
    { role: "user", content: asked },
  ];

  try {
    await assertUnderCostCap();
  } catch (e) {
    if (e instanceof CostCapError) return { kind: "over_cap" };
    throw e;
  }

  // One deadline for the whole turn, composed with the per-request timeout at
  // each call. `chat()` has always accepted a signal; nothing ever passed one.
  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), TURN_DEADLINE_MS);

  // Cost accrues across rounds and is written ONCE, off the critical path. It
  // is accounting, not enforcement — the daily cap was checked above — so a
  // late write can only delay the NEXT turn's check. `trackDrain` is what
  // keeps SIGTERM waiting for the flush rather than losing it.
  let costUsd = 0;
  let providerMs = 0;
  let rounds = 0;
  let toolRuns = 0;
  let lastModel = "";

  const flush = () => {
    clearTimeout(turnTimer);
    if (costUsd > 0) void trackDrain(recordCostUsd(costUsd).catch(() => undefined));
    console.info(
      `[converse] turn ms=${Date.now() - startedAt} provider_ms=${providerMs} ` +
        `rounds=${rounds} tools=${toolRuns} cost=${costUsd.toFixed(6)} model=${lastModel}`,
    );
  };

  const callProvider = async (withTools: boolean) => {
    const t0 = Date.now();
    const result = await chat({
      messages,
      ...(withTools ? { tools: specs } : {}),
      signal: turnAbort.signal,
    });
    providerMs += Date.now() - t0;
    lastModel = result.model;
    costUsd += computeCost(result.model, result.usage);
    return result;
  };

  try {
    for (rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
      const result = await callProvider(true);

      if (result.toolCalls.length === 0) {
        const text = (result.content ?? "").trim();
        flush();
        return text
          ? { kind: "answered", text: text.slice(0, MAX_REPLY_CHARS) }
          : { kind: "failed", error: "empty response" };
      }

      // Past the per-turn ceiling, stop spending and answer from what is in
      // hand rather than starting another round.
      if (costUsd >= TURN_COST_CAP_USD) break;

      input.onProgress?.({
        kind: "tools",
        names: result.toolCalls.map((c) => c.function.name),
      });

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      // Tools within a round are independent; run them together. The catch is
      // INSIDE each mapped function so no promise rejects — one failing tool
      // still returns its `{error}` payload and the others still land. Results
      // are pushed in the model's original order, which some providers care
      // about when matching `tool_call_id`s.
      const payloads = await Promise.all(
        result.toolCalls.map(async (call) => {
          try {
            // Arguments are the model's, so they are parsed defensively: a
            // malformed blob becomes an empty object and the tool's own
            // resolvers reject it, rather than throwing mid-turn.
            let args: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(call.function.arguments || "{}");
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                args = parsed as Record<string, unknown>;
              }
            } catch {
              args = {};
            }
            const rows = await runTool(
              call.function.name,
              input.role,
              commandAllowed,
              {
                role: input.role,
                profileId: input.profileId,
                chatId: input.chatId,
                locale: input.locale,
              },
              args,
            );
            return JSON.stringify(rows);
          } catch (e) {
            // A refused or unknown tool is reported back to the model as a
            // result, not thrown: it can answer without that data instead of
            // the whole turn dying.
            return JSON.stringify({ error: e instanceof Error ? e.message : "tool failed" });
          }
        }),
      );
      toolRuns += result.toolCalls.length;

      result.toolCalls.forEach((call, i) => {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: (payloads[i] ?? "{}").slice(0, 6000),
        });
      });

      input.onProgress?.({ kind: "thinking" });
    }

    // Round cap or cost ceiling hit: ask for a final answer with no tools on
    // offer, so the model must conclude from what it already has.
    const final = await callProvider(false);
    const text = (final.content ?? "").trim();
    flush();
    return text
      ? { kind: "answered", text: text.slice(0, MAX_REPLY_CHARS) }
      : { kind: "failed", error: "no answer after tool rounds" };
  } catch (e) {
    flush();
    if (e instanceof ProviderNotConfiguredError) return { kind: "not_configured" };
    if (e instanceof CostCapError) return { kind: "over_cap" };
    if (turnAbort.signal.aborted) return { kind: "failed", error: "turn deadline" };
    return { kind: "failed", error: e instanceof Error ? e.message : "unknown" };
  }
}
