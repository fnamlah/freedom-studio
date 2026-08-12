/**
 * The agentic chat loop (docs/11 §4.3).
 *
 * SERVER-ONLY. Orchestrates one assistant turn:
 *   budget check → redact user text → provider.chat (streaming, with tool defs)
 *   → on tool_call, execute under the CALLER's client → redact the result →
 *   feed back → repeat (max 6 rounds) → persist redacted `ai_messages` → meter
 *   `ai_usage`.
 *
 * Two clients are required and they are NOT interchangeable:
 *   - `supabase`  — the caller's RLS-scoped client. Tools execute under it (so
 *     RLS is the final authority) and own-only `ai_messages` are persisted with
 *     it.
 *   - `service`   — a service-role client. Budget checks read the GLOBAL usage
 *     window and `ai_usage` inserts are service-only (docs/04, docs/11 §8).
 *
 * Only the REDACTED projection is ever persisted (docs/11 §5): `ai_messages`
 * doubles as the after-the-fact record of exactly what left for the provider.
 */

import type { Json, TablesInsert } from "@/lib/database.types";
import { dict } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { getSetting } from "@/lib/settings";

import { checkBudget, recordUsage } from "./budget";
import {
  getActiveProviderId,
  getChatModel,
  getActiveProvider,
} from "./provider";
import { getToolDefinitions, executeTool } from "./registry";
import { redactToolResult, scrubText } from "./redactor";
import {
  emptyUsage,
  isNotConfiguredError,
  type AiSupabaseClient,
  type ChatDelta,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderId,
  type ToolCall,
  type Usage,
} from "./types";

const MAX_ROUNDS = 6;

/**
 * The domain rules. Deliberately English in BOTH locales: they are written
 * against the same English vocabulary the tool `description` strings in
 * `./registry` use, and the model maps a Russian question onto that vocabulary
 * far more reliably than onto a translated paraphrase of it. What changes per
 * locale is the OUTPUT language instruction below — the one thing the reader
 * actually experiences.
 */
const DOMAIN_RULES = [
  "You are the Freedom Studio assistant, an internal analyst for a talent-management studio.",
  "Answer operational and financial questions using ONLY the provided tools; never invent figures.",
  "Tool results are already de-identified aggregates — refer to people by their stage or display names.",
  "Call a tool whenever a question needs data. If a tool returns no rows, say so plainly.",
  "Be concise. Format money and percentages clearly. Do not ask the user for UUIDs — use names.",
].join(" ");

/**
 * The output-language clause, stated three ways on purpose: as an English
 * instruction (which the rest of the prompt has already put the model in the
 * frame of), as the same instruction IN the target language, and as an explicit
 * ban on the other language. A single sentence is easy for a model mid-answer to
 * drift away from once the tool results — whose keys and enum values are all
 * English — start arriving; the repetition is what makes compliance stick.
 *
 * Names inside tool results (stage names, platform names, category names) are
 * data, not prose, and are quoted as they come back rather than transliterated.
 */
const LANGUAGE_CLAUSE: Record<Locale, string> = {
  en: [
    "Always answer in English, regardless of the language the question was asked in.",
    "Reproduce names, identifiers and category labels from tool results exactly as they appear.",
  ].join(" "),
  ru: [
    "ALWAYS answer in Russian. Отвечай ТОЛЬКО по-русски, даже если вопрос задан по-английски.",
    "Never answer in English: every sentence you write to the user must be in Russian.",
    "Названия, имена и категории из результатов инструментов приводи ровно так, как они пришли,",
    "не переводя и не транслитерируя их.",
  ].join(" "),
};

/** The system prompt for one reader. The ONLY locale-dependent part is the language clause. */
export function systemPromptFor(locale: Locale): string {
  return `${DOMAIN_RULES} ${LANGUAGE_CLAUSE[locale]}`;
}

export interface RunAgentTurnOptions {
  /** Full message history for this turn (system prompt optional — one is added). */
  messages: ChatMessage[];
  userId: string;
  /** CALLER's RLS-scoped client — tools + `ai_messages` persistence. */
  supabase: AiSupabaseClient;
  /** SERVICE-role client — budget window read + `ai_usage` insert. */
  service: AiSupabaseClient;
  conversationId: string;
  /** Streams incremental assistant text as it is produced. */
  onDelta?: (text: string) => void;
  /**
   * The CALLER's language (`profiles.locale`). Decides the language the
   * assistant answers in; defaults to the studio's Russian.
   */
  locale?: Locale;
  /** Optional override of the system prompt. Wins over `locale` when set. */
  systemPrompt?: string;
  signal?: AbortSignal;
}

export type RunAgentTurnStatus =
  | "ok"
  | "rate_limited"
  | "budget_exceeded"
  | "not_configured"
  | "error";

export interface RunAgentTurnResult {
  ok: boolean;
  status: RunAgentTurnStatus;
  content: string | null;
  usage: Usage;
  toolCallsCount: number;
  rounds: number;
  reason?: string;
}

/** Persist one redacted `ai_messages` row; never throws (metering-grade). */
async function persistMessage(
  sb: AiSupabaseClient,
  row: TablesInsert<"ai_messages">,
): Promise<void> {
  try {
    const { error } = await sb.from("ai_messages").insert(row);
    if (error) console.error("[ai.agent] persist message failed", error.message);
  } catch (e) {
    console.error("[ai.agent] persist message threw", e instanceof Error ? e.message : e);
  }
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** Scrub free text on user messages before they cross to the provider. */
function redactOutbound(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "user" && typeof m.content === "string"
      ? { ...m, content: scrubText(m.content) }
      : m,
  );
}

export async function runAgentTurn(
  opts: RunAgentTurnOptions,
): Promise<RunAgentTurnResult> {
  const { userId, supabase, service, conversationId, onDelta, signal } = opts;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const startedAt = Date.now();
  const usageTotal = emptyUsage();
  let toolCallsCount = 0;

  // 1. Budget check BEFORE any provider work (docs/11 §8). Refusals are metered.
  const budget = await checkBudget(userId, service, locale);
  if (!budget.ok && budget.status !== "ok") {
    await meterRefusal(service, userId, conversationId, budget.status);
    return {
      ok: false,
      status: budget.status,
      content: null,
      usage: usageTotal,
      toolCallsCount: 0,
      rounds: 0,
      reason: budget.reason,
    };
  }

  // 2. Resolve provider + model. Surfaces NotConfiguredError cleanly.
  let provider: ProviderAdapter;
  let model: string;
  try {
    provider = await getActiveProvider();
    model = await getChatModel();
  } catch (e) {
    if (isNotConfiguredError(e)) {
      return {
        ok: false,
        status: "not_configured",
        content: null,
        usage: usageTotal,
        toolCallsCount: 0,
        rounds: 0,
        reason: e.message,
      };
    }
    throw e;
  }
  const providerId: ProviderId = provider.id;

  // 3. Persist the incoming user message (redacted) so the log is complete even
  //    if the provider call fails downstream.
  const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
  if (lastUser && typeof lastUser.content === "string") {
    await persistMessage(supabase, {
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: scrubText(lastUser.content),
    });
  }

  // 4. Build the provider message list (system prompt + scrubbed history).
  const systemPrompt = opts.systemPrompt ?? systemPromptFor(locale);
  const providerMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...redactOutbound(opts.messages.filter((m) => m.role !== "system")),
  ];

  const toolDefs = getToolDefinitions();
  let finalContent: string | null = null;
  let lastAssistant = "";
  let rounds = 0;

  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;

      const stream = provider.chat({
        messages: providerMessages,
        model,
        tools: toolDefs,
        stream: true,
        temperature: 0.2,
        signal,
      });

      let assistantContent = "";
      let toolCalls: ToolCall[] = [];
      let roundUsage: Usage | null = null;

      for await (const delta of stream as AsyncIterable<ChatDelta>) {
        if (delta.type === "text") {
          assistantContent += delta.text;
          onDelta?.(delta.text);
        } else {
          toolCalls = delta.toolCalls;
          roundUsage = delta.usage;
          if (delta.content != null) assistantContent = delta.content;
        }
      }
      lastAssistant = assistantContent;

      if (roundUsage) {
        usageTotal.promptTokens += roundUsage.promptTokens;
        usageTotal.completionTokens += roundUsage.completionTokens;
        usageTotal.totalTokens += roundUsage.totalTokens;
      }

      // Persist the assistant message (content redacted; tool-call requests kept
      // as tool_args so the log shows what the model asked for).
      await persistMessage(supabase, {
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : null,
        provider: providerId,
        model,
        tool_args: toolCalls.length > 0 ? toJson(toolCalls) : null,
      });

      // Echo the assistant turn back into the provider transcript.
      providerMessages.push({
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) {
        finalContent = assistantContent.length > 0 ? assistantContent : null;
        break;
      }

      // Execute each tool under the CALLER's client, redact, feed back.
      for (const tc of toolCalls) {
        toolCallsCount++;
        let args: unknown = {};
        let projected: Record<string, unknown>[];
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          const rows = await executeTool(tc.function.name, args, supabase, locale);
          projected = redactToolResult(tc.function.name, rows);
        } catch (e) {
          projected = [{ error: e instanceof Error ? e.message : "tool error" }];
        }

        const resultJson = JSON.stringify(projected);
        providerMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultJson,
        });

        // Persist the REDACTED tool result — this row is the egress audit.
        await persistMessage(supabase, {
          conversation_id: conversationId,
          user_id: userId,
          role: "tool",
          tool_name: tc.function.name,
          tool_args: toJson(args),
          tool_result: projected as unknown as Json,
          provider: providerId,
          model,
        });
      }
    }
  } catch (e) {
    await recordUsage(
      {
        userId,
        conversationId,
        requestKind: "chat",
        provider: providerId,
        model,
        promptTokens: usageTotal.promptTokens,
        completionTokens: usageTotal.completionTokens,
        toolCalls: toolCallsCount,
        status: "error",
        durationMs: Date.now() - startedAt,
      },
      service,
    );
    return {
      ok: false,
      status: "error",
      content: null,
      usage: usageTotal,
      toolCallsCount,
      rounds,
      reason:
        e instanceof Error ? e.message : dict(locale).adminAi.assistant.errRequestFailed,
    };
  }

  if (finalContent === null) finalContent = lastAssistant.length > 0 ? lastAssistant : null;

  // 5. Meter the successful turn.
  await recordUsage(
    {
      userId,
      conversationId,
      requestKind: "chat",
      provider: providerId,
      model,
      promptTokens: usageTotal.promptTokens,
      completionTokens: usageTotal.completionTokens,
      toolCalls: toolCallsCount,
      status: "ok",
      durationMs: Date.now() - startedAt,
    },
    service,
  );

  return {
    ok: true,
    status: "ok",
    content: finalContent,
    usage: usageTotal,
    toolCallsCount,
    rounds,
  };
}

/** Record a metered refusal (rate-limit / budget) with zero tokens. */
async function meterRefusal(
  service: AiSupabaseClient,
  userId: string,
  conversationId: string,
  status: "rate_limited" | "budget_exceeded",
): Promise<void> {
  try {
    const providerId = await getActiveProviderId();
    const model = await getSetting(
      `ai.chat_model.${providerId}`,
      providerId === "moonshot" ? "kimi-k3" : "glm-5.2",
    );
    await recordUsage(
      {
        userId,
        conversationId,
        requestKind: "chat",
        provider: providerId,
        model,
        promptTokens: 0,
        completionTokens: 0,
        status,
      },
      service,
    );
  } catch (e) {
    console.error("[ai.agent] refusal metering failed", e instanceof Error ? e.message : e);
  }
}
