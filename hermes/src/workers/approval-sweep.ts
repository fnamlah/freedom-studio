import { executeApproval } from "../governance/approvals.js";
import { env } from "../config/env.js";
import { alertOwner } from "../lib/owner.js";
import { getAdminClient } from "../lib/supabase.js";
import { runLoop } from "./loop.js";

/**
 * The bridge between "a human approved" and "it happened".
 *
 * A Telegram button tap can execute inline, but an approval clicked in the web
 * app cannot: the Next.js server action runs under the approver's own RLS
 * session and has no service-role client — deliberately, per docs/11. So the
 * app only records the decision, and this loop performs it.
 *
 * It also drives retries. `executeApproval` releases its claim and stamps
 * `next_attempt_at` on a recoverable failure; this sweep is what comes back.
 *
 * It never decides anything. It only ever acts on rows that already reached
 * `approved` through `decide_approval`.
 */

const BATCH = 10;

async function expirePastTtl(): Promise<void> {
  const db = getAdminClient();
  const { data } = await db
    .from("hermes_approvals")
    .update({ state: "expired" })
    .eq("state", "pending")
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString())
    .select("id");

  // Silence here would be wrong: an expired proposal is a decision the owner
  // did not get to make, and they should know it lapsed.
  if (data?.length) {
    await alertOwner(`${data.length} Hermes proposal(s) expired without a decision.`, {
      key: "expired",
      throttleMs: 6 * 3_600_000,
    });
  }
}

async function sweepOnce(): Promise<void> {
  await expirePastTtl();

  const nowIso = new Date().toISOString();
  const { data, error } = await getAdminClient()
    .from("hermes_approvals")
    .select("id")
    .eq("state", "approved")
    .is("executed_at", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("decided_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(`approval sweep: ${error.message}`);
  if (!data?.length) return;

  // Sequential on purpose. These are money-adjacent writes; the atomic claim
  // makes concurrency safe, but it does not make it desirable.
  for (const row of data) {
    const result = await executeApproval(row.id);
    console.info(`[approval-sweep] ${row.id}: ${result.ok ? "ok" : "failed"} — ${result.message}`);
  }
}

export function runApprovalSweep(): Promise<void> {
  return runLoop("approval-sweep", env.HERMES_APPROVAL_SWEEP_MS, sweepOnce);
}
