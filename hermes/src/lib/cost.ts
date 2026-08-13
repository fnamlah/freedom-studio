import { env } from "../config/env.js";
import { getPolicyValue } from "./policy-kv.js";
import { getAdminClient } from "./supabase.js";

/**
 * Spend metering and the circuit breaker.
 *
 * ⚠ NOT YET WIRED. The intent is that every LLM call the worker makes passes
 * `assertUnderCostCap()` first and `recordCost()` after — an unattended agent
 * with no cap is an unbounded bill. Today the worker makes NO provider calls at
 * all (see jobs/morning-brief.ts: the digest is exact aggregates, not prose), so
 * nothing calls either function. The consequences, stated plainly so nobody
 * mistakes this for a live control:
 *
 *   - `todaysCost()` always reads 0, so `overCap()` is permanently false and the
 *     `usesLlm` gate in scheduler/run.ts never trips.
 *   - the `/cost` Telegram command always reports $0 spent.
 *   - `CostCapError` is currently unthrowable.
 *
 * Wire both calls in with the FIRST provider call added to the worker — that is
 * the change that makes this file load-bearing.
 */

export class CostCapError extends Error {
  constructor(
    readonly spent: number,
    readonly cap: number,
  ) {
    super(`Daily AI cost cap reached: $${spent.toFixed(4)} of $${cap.toFixed(2)}`);
    this.name = "CostCapError";
  }
}

/** USD per 1M tokens. Keys are matched as SUBSTRINGS of the model id. */
const PRICES: Record<string, { in: number; out: number }> = {
  "kimi-k3": { in: 0.6, out: 2.5 },
  "glm-5.2": { in: 0.6, out: 2.2 },
  "glm-4": { in: 0.5, out: 2.0 },
};

export function computeCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const m = model.toLowerCase();
  const price = Object.entries(PRICES).find(([k]) => m.includes(k))?.[1];
  // An unknown model can't be priced — don't invent a number and don't block on it.
  if (!price) return 0;
  return (usage.inputTokens * price.in + usage.outputTokens * price.out) / 1_000_000;
}

function dayKey(): string {
  return `daily_cost_usd:${new Date().toISOString().slice(0, 10)}`;
}

async function capUsd(): Promise<number> {
  const fromPolicy = await getPolicyValue<number>("daily_cost_cap_usd");
  return typeof fromPolicy === "number" ? fromPolicy : env.HERMES_DAILY_COST_CAP_USD;
}

export async function todaysCost(): Promise<number> {
  const v = await getPolicyValue<number>(dayKey());
  return typeof v === "number" ? v : 0;
}

/** Non-throwing probe used by the scheduler to skip LLM jobs. */
export async function overCap(): Promise<boolean> {
  const cap = await capUsd();
  if (cap <= 0) return false;
  return (await todaysCost()) >= cap;
}

export async function assertUnderCostCap(): Promise<void> {
  const cap = await capUsd();
  if (cap <= 0) return;
  const spent = await todaysCost();
  if (spent >= cap) throw new CostCapError(spent, cap);
}

export async function recordCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const cost = computeCost(model, usage);
  if (cost <= 0) return;
  // 6dp: rounding to 4 sent sub-$0.0001 calls to zero, so they never accumulated.
  const delta = Math.round(cost * 1e6) / 1e6;

  const { error } = await getAdminClient().rpc("hermes_incr_policy_number", {
    p_key: dayKey(),
    p_delta: delta,
    p_description: "Hermes LLM spend for the UTC day",
  });
  if (error) console.warn("[cost] increment failed:", error.message);
}
