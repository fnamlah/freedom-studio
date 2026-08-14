import { enqueueApproval } from "../governance/approvals.js";
import { resolvePolicy } from "../governance/policy.js";
import { getAdminClient } from "../lib/supabase.js";
import { channelsSatisfying } from "../lib/owner.js";
import { hermesDict, hermesEn as hermesEnDict, hermesRu as hermesRuDict, money } from "../lib/i18n.js";
import { sendApprovalCard } from "../telegram/api.js";

/**
 * Period-close watch — the job that gives the approvals queue something to hold.
 *
 * It looks for earnings in a finished month that have no `earning_share` ledger
 * entries, which is exactly the state "this period was never closed". It does
 * not close anything. It writes a proposal and stops.
 *
 * The month must be *over* before it is proposed: closing a period while
 * earnings are still being entered would post shares against a partial month and
 * the correction is a manual ledger adjustment.
 */

/** First and last day of the month before the current one, in UTC. */
function previousMonthBounds(now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // day 0 of this month = last day of previous
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** `now` is injectable so the month-boundary logic can be tested against a fixed date. */
export async function runPeriodCloseWatch(now: Date = new Date()): Promise<string> {
  const db = getAdminClient();
  const { start, end } = previousMonthBounds(now);

  // Earnings carry their own period, so match rows whose period sits inside the
  // month rather than filtering on a single date column.
  const { data: earnings, error } = await db
    .from("earnings")
    .select("id, gross_amount")
    .gte("period_start", start)
    .lte("period_end", end);

  if (error) throw new Error(`close watch: ${error.message}`);
  if (!earnings?.length) return `no earnings in ${start}..${end}`;

  // Which of those earnings already produced share entries? An earning with any
  // earning_share row was closed; the period is open only if some have none.
  const ids = earnings.map((e) => e.id);
  const { data: posted, error: ledgerError } = await db
    .from("ledger_entries")
    .select("earning_id")
    .eq("entry_type", "earning_share")
    .in("earning_id", ids);

  if (ledgerError) throw new Error(`close watch ledger: ${ledgerError.message}`);

  const closed = new Set((posted ?? []).map((r) => r.earning_id));
  const open = earnings.filter((e) => !closed.has(e.id));
  if (open.length === 0) return `${start}..${end} already closed`;

  const total = open.reduce((sum, e) => sum + Number(e.gross_amount ?? 0), 0);

  // The idempotency key is the period itself, so re-running daily updates
  // nothing and does not stack duplicate proposals in the queue.
  const { id: approvalId } = await enqueueApproval({
    actionType: "close_period",
    payload: { period_start: start, period_end: end },
    // The preview is written ONCE and read later by two surfaces in two
    // languages, so both renderings are stored now rather than translated at
    // display time. `summary` is kept as well: rows written before 019 have
    // only that key, and the readers fall back to it.
    preview: {
      summary: hermesEnDict.closeSummary(start, end, open.length),
      summary_en: hermesEnDict.closeSummary(start, end, open.length),
      summary_ru: hermesRuDict.closeSummary(start, end, open.length),
      period: `${start} → ${end}`,
      unclosed_earnings: open.length,
      gross_in_period: total.toFixed(2),
      // `hermes_approvals.risk_reason` is a single text column, so the Russian
      // rendering rides along in the preview jsonb next to the summaries.
      risk_en: hermesEnDict.closeRisk,
      risk_ru: hermesRuDict.closeRisk,
    },
    riskReason: hermesEnDict.closeRisk,
    jobName: "period_close_watch",
    idempotencyKey: `close_period:${start}:${end}`,
  });

  // Cards go to every paired chat whose role could decide this — with buttons
  // that decide_approval will re-authorize per tap regardless.
  const requiredRole = resolvePolicy("close_period").requiredRole ?? "super_admin";
  for (const target of await channelsSatisfying(requiredRole)) {
    const h = hermesDict(target.locale);
    await sendApprovalCard(
      target.chatId,
      approvalId,
      [
        `<b>${h.closeCardTitle}</b>`,
        `${start} → ${end}`,
        h.closeCardBody(open.length, money(total, target.locale)),
      ].join("\n"),
      target.locale,
    );
  }

  return `proposed close_period ${start}..${end} (${open.length} unclosed)`;
}
