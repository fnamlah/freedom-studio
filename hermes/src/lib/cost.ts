import { env } from "../config/env.js";
import { getPolicyValue } from "./policy-kv.js";
import { getAdminClient } from "./supabase.js";

/**
 * Spend metering and the circuit breaker.
 *
 * LIVE as of the conversational Telegram turn (`llm/converse.ts`), which is the
 * worker's first and so far only provider call: it runs `assertUnderCostCap()`
 * before the first request of a turn and `recordCost()` after every response,
 * including the tool rounds. An unattended agent with no cap is an unbounded
 * bill, so this is a real circuit breaker now, not scaffolding — `/cost`
 * reports actual spend and `CostCapError` is reachable.
 *
 * The scheduled jobs still make NO provider calls (morning-brief and friends
 * are exact aggregates, not prose), so the `usesLlm` gate in scheduler/run.ts
 * remains unexercised — it is armed, not dead.
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
  // Hermes' chat model (measured 2.5x faster than k3 for short tool-using
  // replies). Priced at the k3 rate as a deliberate over-estimate: k2.6 is an
  // older, cheaper model, so this can only over-report spend, never under.
  // Replace with the published rate when someone confirms it.
  "kimi-k2": { in: 0.6, out: 2.5 },
  "glm-5.2": { in: 0.6, out: 2.2 },
  "glm-4": { in: 0.5, out: 2.0 },
};

/**
 * The price used when a model id matches nothing in `PRICES` — the most
 * expensive rate we know, deliberately.
 *
 * Pricing to ZERO was the old behaviour and it silently disarmed the breaker:
 * the model id is a free-text super-admin setting (`ai.chat_model.<provider>`),
 * so an ordinary version bump — `kimi-k3` → `kimi-k4` — made every call cost 0,
 * `todaysCost()` stay 0 forever, `assertUnderCostCap()` never throw, and
 * `/cost` report $0 while real money was spent. A cap that quietly stops
 * capping is worse than no cap, because the dashboards agree with it.
 *
 * Over-estimating is the safe direction: the worst case is the agent pausing
 * itself early and someone adding a price, not an unbounded bill.
 */
const UNPRICED_FALLBACK = { in: 1.0, out: 3.0 };

let warnedUnpriced = "";

export function computeCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const m = model.toLowerCase();
  const price = Object.entries(PRICES).find(([k]) => m.includes(k))?.[1] ?? unpriced(model);
  return (usage.inputTokens * price.in + usage.outputTokens * price.out) / 1_000_000;
}

function unpriced(model: string): { in: number; out: number } {
  // Once per model per process — a warning on every call would bury itself.
  if (warnedUnpriced !== model) {
    warnedUnpriced = model;
    console.warn(
      `[cost] no price for model "${model}" — metering at the conservative ` +
        `$${UNPRICED_FALLBACK.in}/$${UNPRICED_FALLBACK.out} per 1M. Add it to PRICES.`,
    );
  }
  return UNPRICED_FALLBACK;
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
  return recordCostUsd(computeCost(model, usage));
}

/**
 * Add an already-computed amount to today's accumulator.
 *
 * A conversational turn makes several provider calls and used to write one row
 * per call, on the critical path. It now sums them and calls this once, which
 * is the same arithmetic in one round trip instead of up to five.
 */
export async function recordCostUsd(cost: number): Promise<void> {
  if (!Number.isFinite(cost) || cost <= 0) return;
  // 6dp: rounding to 4 sent sub-$0.0001 calls to zero, so they never accumulated.
  const delta = Math.round(cost * 1e6) / 1e6;

  const { error } = await getAdminClient().rpc("hermes_incr_policy_number", {
    p_key: dayKey(),
    p_delta: delta,
    p_description: "Hermes LLM spend for the UTC day",
  });
  if (error) console.warn("[cost] increment failed:", error.message);
}
