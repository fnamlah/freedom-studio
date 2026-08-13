/**
 * Budget enforcement and usage metering (docs/11 §8).
 *
 * SERVER-ONLY. `ai_usage` is service-role-write and mostly own-row read, so the
 * client passed to these functions must be SERVICE-CAPABLE:
 *   - `checkBudget` sums the GLOBAL daily token window, which a non-SA caller's
 *     RLS cannot see — the route must pass its service-role client.
 *   - `recordUsage` INSERTs, which no application role may do (docs/04 §4.21) —
 *     this is a sanctioned service write, exactly like the audit trail.
 *
 * The three budget knobs are SA-tunable `app_settings` values; all three are
 * checked BEFORE any provider call, and refusals are themselves metered so abuse
 * patterns stay visible.
 */

import { dict } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locales";
import { getSetting } from "@/lib/settings";

import type { AiSupabaseClient, ProviderId } from "./types";

export type BudgetStatus = "ok" | "rate_limited" | "budget_exceeded";

export interface BudgetCheck {
  ok: boolean;
  status: BudgetStatus;
  /** Human-readable refusal message; `undefined` when ok. */
  reason?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Enforce the three budgets (docs/11 §8) against `ai_usage` for the caller and
 * globally. Returns a non-throwing verdict; the gateway records the refusal and
 * declines the request when `ok` is false.
 *
 * @param client a SERVICE-CAPABLE client (global window needs cross-user read).
 * @param locale the CALLER's language — `reason` is read by a person, and on the
 *               chat surface it is streamed straight into the transcript.
 */
export async function checkBudget(
  userId: string,
  client: AiSupabaseClient,
  locale: Locale = DEFAULT_LOCALE,
): Promise<BudgetCheck> {
  const d = dict(locale).adminAi.assistant;
  // The caps are read as digits by a human, so group them in their own locale.
  const num = (value: number) => new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);

  const [reqPerHour, tokPerUserDay, tokGlobalDay] = await Promise.all([
    getSetting("ai.limits.requests_per_user_per_hour", 30),
    getSetting("ai.limits.tokens_per_user_per_day", 200_000),
    getSetting("ai.limits.tokens_global_per_day", 1_000_000),
  ]);

  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();

  // 1. Per-user request rate (this hour).
  const { count: reqCount, error: reqErr } = await client
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", hourAgo);
  if (!reqErr && (reqCount ?? 0) >= reqPerHour) {
    return {
      ok: false,
      status: "rate_limited",
      reason: d.refusalHourly(num(reqPerHour)),
    };
  }

  // 2. Per-user token budget (this day).
  const userTokens = await sumTokens(client, dayAgo, userId);
  if (userTokens >= tokPerUserDay) {
    return {
      ok: false,
      status: "budget_exceeded",
      reason: d.refusalDailyTokens(num(tokPerUserDay)),
    };
  }

  // 3. Global token budget (this day).
  const globalTokens = await sumTokens(client, dayAgo, null);
  if (globalTokens >= tokGlobalDay) {
    return {
      ok: false,
      status: "budget_exceeded",
      reason: d.refusalGlobalTokens,
    };
  }

  return { ok: true, status: "ok" };
}

async function sumTokens(
  client: AiSupabaseClient,
  sinceIso: string,
  userId: string | null,
): Promise<number> {
  let query = client
    .from("ai_usage")
    .select("prompt_tokens, completion_tokens")
    .gte("created_at", sinceIso);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error || !data) return 0;
  let total = 0;
  for (const row of data) {
    total += (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0);
  }
  return total;
}

/** Outcome status — constrained to the `ai_usage_status_chk` CHECK (migration 004). */
export type UsageStatus = "ok" | "error" | "rate_limited" | "budget_exceeded";

export interface RecordUsageInput {
  userId: string;
  conversationId?: string | null;
  /**
   * Must stay in step with the `ai_request_kind` DB enum — this union is
   * hand-maintained and silently missed `agent` when migration 015 added it.
   */
  requestKind: "chat" | "embedding" | "report" | "classify" | "analyse" | "agent" | "extract";
  provider: ProviderId;
  model: string;
  promptTokens: number;
  completionTokens: number;
  toolCalls?: number;
  /** Defaults to 'ok'. MUST be one of the four `UsageStatus` values (DB CHECK). */
  status?: UsageStatus;
  durationMs?: number;
}

/**
 * Insert one `ai_usage` metering row (docs/11 §8). Best-effort like the audit
 * writer: a metering hiccup logs and returns `false` rather than failing the
 * business action it accompanies.
 *
 * @param client a SERVICE-CAPABLE client (the gateway's service-role client).
 */
export async function recordUsage(
  input: RecordUsageInput,
  client: AiSupabaseClient,
): Promise<boolean> {
  try {
    const { error } = await client.from("ai_usage").insert({
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      request_kind: input.requestKind,
      provider: input.provider,
      model: input.model,
      prompt_tokens: Math.max(0, Math.round(input.promptTokens)),
      completion_tokens: Math.max(0, Math.round(input.completionTokens)),
      tool_call_count: Math.max(0, Math.round(input.toolCalls ?? 0)),
      status: input.status ?? "ok",
      duration_ms:
        input.durationMs === undefined ? null : Math.max(0, Math.round(input.durationMs)),
    });
    if (error) {
      console.error("[ai.usage] insert failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[ai.usage] insert threw", e instanceof Error ? e.message : e);
    return false;
  }
}
