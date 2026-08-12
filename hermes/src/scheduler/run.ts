import { env } from "../config/env.js";
import { alertOwner } from "../lib/owner.js";
import { getPolicyValue, isEnabled, setPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { runLoop } from "../workers/loop.js";
import { jobs, type HermesJob } from "./registry.js";

const BACKOFF_CAP_MS = 6 * 60 * 60_000;
const ALERT_AFTER = 3;

/** In-memory failure tracking; a restart legitimately clears the penalty. */
const failures = new Map<string, { n: number; nextEligibleAt: number }>();

/** Exported pure so the backoff curve can be tested without a clock or a DB. */
export function backoffDelayMs(n: number, tickMs = env.HERMES_SCHEDULER_TICK_MS, capMs = BACKOFF_CAP_MS): number {
  return Math.min(tickMs * 2 ** n, capMs);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDue(job: HermesJob, now: Date): boolean {
  if (now.getUTCHours() < job.gate.hourUtc) return false;
  if (job.gate.dayOfWeek !== undefined && now.getUTCDay() !== job.gate.dayOfWeek) return false;
  return true;
}

/** Run a job and record it, whatever happens. History is diagnostics — it must never break the job. */
export async function runJobNow(job: HermesJob): Promise<string | void> {
  const startedAt = new Date();
  let status: "ok" | "failed" = "ok";
  let outcome: string | undefined;
  let error: string | undefined;

  try {
    const result = await job.handler();
    outcome = typeof result === "string" ? result : undefined;
    return result;
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const finishedAt = new Date();
    await getAdminClient()
      .from("hermes_job_runs")
      .insert({
        job_name: job.name,
        status,
        outcome: outcome?.slice(0, 2000),
        error: error?.slice(0, 1000),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
      })
      .then(undefined, (e: unknown) =>
        console.warn("[scheduler] job-run insert failed:", e instanceof Error ? e.message : e),
      );
  }
}

async function runClaimedJob(job: HermesJob): Promise<void> {
  try {
    const outcome = await runJobNow(job);
    failures.delete(job.name);
    console.info(`[scheduler] ${job.name}: ${outcome ?? "done"}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A failed job must NOT consume its once-per-day slot.
    await setPolicyValue(`job_last:${job.name}`, "").catch(() => {});

    const prev = failures.get(job.name)?.n ?? 0;
    const n = prev + 1;
    failures.set(job.name, { n, nextEligibleAt: Date.now() + backoffDelayMs(n) });
    console.error(`[scheduler] ${job.name} failed (${n}):`, message);

    if (n >= ALERT_AFTER) {
      await alertOwner(`Hermes job "${job.name}" failed ${n}x: ${message}`, {
        key: `job:${job.name}`,
        throttleMs: 12 * 60 * 60_000,
      }).catch(() => {});
    }
  }
}

async function tick(): Promise<void> {
  if (!(await isEnabled("agent_enabled"))) return;

  const now = new Date();
  const day = today();
  const claimed: HermesJob[] = [];

  for (const job of jobs()) {
    if (!isDue(job, now)) continue;

    const failure = failures.get(job.name);
    if (failure && Date.now() < failure.nextEligibleAt) continue;

    // Cheap pre-check before paying for the claim round-trip.
    if ((await getPolicyValue<string>(`job_last:${job.name}`)) === day) continue;

    if (job.usesLlm) {
      const { overCap } = await import("../lib/cost.js");
      // `continue`, not skip-for-the-day: raising the cap mid-day should recover.
      if (await overCap()) continue;
    }

    const { data: won, error } = await getAdminClient().rpc("hermes_claim_job", {
      p_job: job.name,
      p_day: day,
    });
    if (error) {
      console.warn(`[scheduler] claim failed for ${job.name}:`, error.message);
      continue;
    }
    if (won === true) claimed.push(job);
  }

  // Concurrently: one slow job must not block the rest of the day's work.
  await Promise.allSettled(claimed.map((j) => runClaimedJob(j)));
}

export async function runScheduler(): Promise<void> {
  return runLoop("scheduler", env.HERMES_SCHEDULER_TICK_MS, tick);
}
