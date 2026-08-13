import { commandAllowed } from "../telegram/access.js";
import { assertUnderCostCap, recordCost, CostCapError } from "../lib/cost.js";
import { hermesDict, type Locale } from "../lib/i18n.js";
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
 *   1. COST — `assertUnderCostCap()` before the first call and `recordCost()`
 *      after every one. This is the change that finally makes `lib/cost.ts`
 *      load-bearing: before today the worker made no provider calls, so the
 *      cap was unthrowable and `/cost` always read $0.
 *   2. EGRESS — the person's message is scrubbed by the app's real redactor
 *      before it leaves, and every tool result is projected by it. There is no
 *      other serialization path from here to a provider.
 *   3. ROUNDS — a hard cap; a model that keeps calling tools is cut off and
 *      answers with what it has.
 *   4. ROLE — tools are offered per role and re-checked at execution.
 *
 * History is deliberately NOT persisted across turns: each message is answered
 * on its own. A stored conversation is a stored copy of whatever staff type
 * into Telegram, and that is a retention decision for the owner, not a side
 * effect of making the bot chatty.
 *
 * What IS recorded: the inbound message, by the dedupe insert in
 * `telegram/handler.ts` (`hermes_messages`, direction `inbound`). Hermes'
 * REPLIES are not stored anywhere — say so plainly rather than implying a
 * trail that does not exist. Storing them is the same retention decision.
 */

const MAX_ROUNDS = 4;
const MAX_REPLY_CHARS = 3500;

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

export async function converse(input: {
  text: string;
  role: string;
  locale: Locale;
  profileId: string;
}): Promise<ConverseOutcome> {
  const specs = specsForRole(input.role, commandAllowed);

  // The human's own words are the one free text that crosses. Scrubbed by the
  // app's real redactor: emails, phone numbers and card-like strings masked
  // before they can leave, exactly as the app does for chat input.
  const asked = scrubText(input.text).slice(0, 2000);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.locale, input.role) },
    { role: "user", content: asked },
  ];

  try {
    await assertUnderCostCap();
  } catch (e) {
    if (e instanceof CostCapError) return { kind: "over_cap" };
    throw e;
  }

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const result = await chat({ messages, tools: specs });
      await recordCost(result.model, result.usage);

      if (result.toolCalls.length === 0) {
        const text = (result.content ?? "").trim();
        return text
          ? { kind: "answered", text: text.slice(0, MAX_REPLY_CHARS) }
          : { kind: "failed", error: "empty response" };
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        let payload: string;
        try {
          const rows = await runTool(call.function.name, input.role, commandAllowed);
          payload = JSON.stringify(rows);
        } catch (e) {
          // A refused or unknown tool is reported back to the model as a
          // result, not thrown: it can then answer without that data instead
          // of the whole turn dying.
          payload = JSON.stringify({
            error: e instanceof Error ? e.message : "tool failed",
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: payload.slice(0, 6000),
        });
      }
    }

    // Round cap hit: ask for a final answer with no tools on offer, so the
    // model must conclude from what it already has.
    const final = await chat({ messages, temperature: 0.2 });
    await recordCost(final.model, final.usage);
    const text = (final.content ?? "").trim();
    return text
      ? { kind: "answered", text: text.slice(0, MAX_REPLY_CHARS) }
      : { kind: "failed", error: "no answer after tool rounds" };
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return { kind: "not_configured" };
    if (e instanceof CostCapError) return { kind: "over_cap" };
    return { kind: "failed", error: e instanceof Error ? e.message : "unknown" };
  }
}
