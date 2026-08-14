import { commandAllowed } from "../telegram/access.js";
import { assertUnderCostCap, computeCost, recordCostUsd, CostCapError } from "../lib/cost.js";
import { trackDrain } from "../lib/shutdown.js";
import { type Locale } from "../lib/i18n.js";
import { chat, ProviderNotConfiguredError, type ChatMessage } from "./provider.js";
import { scrubText } from "./redact.js";
import { PROPOSE_ACTION, specsForRole } from "./tool-catalog.js";
import { canRecoverFromStall } from "./recovery.js";
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

/**
 * Turn a thrown tool error into something safe to send to a provider.
 *
 * Everything else that crosses is projected by the redactor; this path is not,
 * so it gets the strongest thing available to free text — the same `scrubText`
 * the human's own message gets — plus a hard cap, so a stack trace or a long
 * enumeration cannot ride out inside an error string.
 */
function toolError(e: unknown): string {
  const raw = e instanceof Error ? e.message : "tool failed";
  return scrubText(raw).slice(0, 300);
}

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
 * Don't start a recovery call we cannot finish. The per-request ceiling is 25s,
 * so attempting one with less than that left would only trade a provider
 * timeout for a turn-deadline abort — a different error, the same silence.
 */
const MIN_RECOVERY_BUDGET_MS = 26_000;

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
  // Distinct from `failed`: nothing is broken, the AI service was too slow.
  // Collapsing the two told Alina the bot had malfunctioned and advised her to
  // "try again", which re-enters the same stall and bills another round.
  | { kind: "timed_out"; reason: string; pendingProposals?: number }
  | { kind: "failed"; error: string; pendingProposals?: number };

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
  /** A file waiting to be filed as a compliance document, when one was sent. */
  attachment?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    receivedAt?: number;
  };
  onProgress?: (stage: ConverseStage) => void;
}): Promise<ConverseOutcome> {
  const startedAt = Date.now();
  const specs = specsForRole(input.role, commandAllowed);

  // The human's own words are the one free text that crosses. Scrubbed by the
  // app's real redactor: emails, phone numbers and card-like strings masked
  // before they can leave, exactly as the app does for chat input.
  const asked = scrubText(input.text).slice(0, 2000);

  const attachmentNote = input.attachment
    ? ` [A file is attached: ${input.attachment.mimeType}, ${(input.attachment.sizeBytes / 1_048_576).toFixed(1)} MB. If the person wants it saved as a compliance document, use hermes_propose_upload_document — it reads the file from this chat; you never see its contents. If you don't know whose document it is or what it is, ask.]`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.locale, input.role) },
    ...(input.history ?? []),
    { role: "user", content: asked + attachmentNote },
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
  const turnTimer = setTimeout(() => turnAbort.abort(new Error("turn deadline")), TURN_DEADLINE_MS);

  // Cost accrues across rounds and is written ONCE, off the critical path. It
  // is accounting, not enforcement — the daily cap was checked above — so a
  // late write can only delay the NEXT turn's check. `trackDrain` is what
  // keeps SIGTERM waiting for the flush rather than losing it.
  let costUsd = 0;
  let providerMs = 0;
  let providerFailMs = 0;
  let providerCalls = 0;
  let toolMs = 0;
  let rounds = 0;
  let toolRuns = 0;
  let lastModel = "";
  let toolNames: string[] = [];
  let recovered = false;
  // S8: how many approval cards this turn ALREADY sent. A failed turn must
  // say so — otherwise "something went wrong" sits directly above a live
  // Approve button, and a rephrased retry can queue a second, different card.
  let proposalsSent = 0;

  const flush = () => {
    clearTimeout(turnTimer);
    if (costUsd > 0) void trackDrain(recordCostUsd(costUsd).catch(() => undefined));
    // `provider_ms` now includes failed calls, with `provider_fail_ms` naming
    // how much of it was wasted, and `tool_ms` closing the last gap that used
    // to be attributable only by arithmetic. A turn line should explain itself.
    console.info(
      `[converse] turn ms=${Date.now() - startedAt} provider_ms=${providerMs} ` +
        `provider_fail_ms=${providerFailMs} provider_calls=${providerCalls} ` +
        `tool_ms=${toolMs} rounds=${rounds} tools=${toolRuns} ` +
        `cost=${costUsd.toFixed(6)} model=${lastModel}` +
        `${toolNames.length ? ` names=${toolNames.join(",")}` : ""}` +
        `${recovered ? " recovered=1" : ""}`,
    );
  };

  const callProvider = async (withTools: boolean) => {
    const t0 = Date.now();
    // BANK THE TIME IN A `finally`. It used to accumulate after the await, so a
    // call that threw contributed its full duration to the wall clock and ZERO
    // to `provider_ms`. That is not a cosmetic accounting slip: it is what made
    // a 25-second provider stall read as 26 seconds of mystery tool time and
    // sent a whole investigation after the database. The same line also carried
    // `costUsd`, so a failed turn under-reported spend — under-counting exactly
    // the most expensive calls against the daily cap.
    try {
      const result = await chat({
        messages,
        ...(withTools ? { tools: specs } : {}),
        signal: turnAbort.signal,
      });
      lastModel = result.model;
      costUsd += computeCost(result.model, result.usage);
      return result;
    } catch (e) {
      providerFailMs += Date.now() - t0;
      throw e;
    } finally {
      providerCalls += 1;
      providerMs += Date.now() - t0;
    }
  };

  /**
   * A stalled round is not the end of the turn.
   *
   * `REQUEST_TIMEOUT_MS` is 25s against a 60s turn deadline, and provider.ts
   * says why in as many words: "At 25s a stalled call still leaves room for the
   * turn to recover and answer", "leave nothing for a retry or a final answer".
   * That headroom was reserved and never used — nothing recovered, so a single
   * stalled request killed a turn with ~29 seconds of budget unspent and a
   * perfectly good tool result already sitting in `messages`.
   *
   * The recovery is deliberately a SMALLER request, not a repeat of the one
   * that just failed: dropping the tool specs removes the largest block in the
   * payload, which is the right move whether the cause was a slow model or a
   * bad socket. The model concludes from what it already has, which is exactly
   * what the round-cap path at the bottom of the loop does.
   */
  const isTimeout = (e: unknown) => e instanceof Error && e.name === "TimeoutError";

  try {
    for (rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
      let result;
      try {
        result = await callProvider(true);
      } catch (e) {
        // Only a per-request stall is recoverable, and only once, and only if
        // we already have tool results worth concluding from. A round-1 stall
        // has nothing in hand, so it falls through and is reported honestly
        // rather than answered from thin air.
        if (
          !canRecoverFromStall({
            errorName: e instanceof Error ? e.name : undefined,
            turnAborted: turnAbort.signal.aborted,
            toolRuns,
            alreadyRecovered: recovered,
            budgetLeftMs: TURN_DEADLINE_MS - (Date.now() - startedAt),
            minBudgetMs: MIN_RECOVERY_BUDGET_MS,
          })
        ) {
          throw e;
        }

        recovered = true;
        input.onProgress?.({ kind: "thinking" });
        break;
      }

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
      const toolT0 = Date.now();
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
                attachment: input.attachment,
              },
              args,
            );
            if (
              call.function.name in PROPOSE_ACTION &&
              rows.some((r) => r.status === "awaiting_approval")
            ) {
              proposalsSent += 1;
            }
            return JSON.stringify(rows);
          } catch (e) {
            // A refused or unknown tool is reported back to the model as a
            // result, not thrown: it can answer without that data instead of
            // the whole turn dying.
            //
            // SCRUBBED, because this IS an egress path and it was missed. A
            // resolver's "did you mean…" text carries live studio data —
            // document titles, account handles, stage names — and it reaches
            // the provider without passing a projection. Scrubbing is weaker
            // than a projection, so `toolError` also caps the length; the
            // structural fix is that resolvers no longer enumerate candidates
            // they were never asked about (see resolve.ts).
            return JSON.stringify({ error: toolError(e) });
          }
        }),
      );
      toolMs += Date.now() - toolT0;
      toolRuns += result.toolCalls.length;
      toolNames = [...toolNames, ...result.toolCalls.map((c) => c.function.name)];

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
    if (turnAbort.signal.aborted) {
      return { kind: "timed_out", reason: "turn deadline", pendingProposals: proposalsSent };
    }
    // A per-request stall reaching here means recovery was impossible (round 1,
    // already used, or out of budget). It is NOT "something went wrong working
    // that out" — it is the AI service being slow, and saying so is the
    // difference between Alina retrying into the same stall and waiting a
    // minute.
    if (isTimeout(e)) {
      return { kind: "timed_out", reason: "provider timeout", pendingProposals: proposalsSent };
    }
    return {
      kind: "failed",
      error: e instanceof Error ? e.message : "unknown",
      pendingProposals: proposalsSent,
    };
  }
}
