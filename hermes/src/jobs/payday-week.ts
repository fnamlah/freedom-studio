/**
 * The pure half of the payday watch — the calendar and key logic, split from
 * the job for the same reason recovery.ts and history.ts are pure modules:
 * this is the part worth testing, and the job half imports env at load.
 */

/** UTC day-of-week ∈ Wed(3)–Sat(6): payday and its catch-up days. */
export function isPaydayWindow(now: Date): boolean {
  const dow = now.getUTCDay();
  return dow >= 3 && dow <= 6;
}

/**
 * The most recent COMPLETE Sunday–Saturday week: ends on the latest Saturday
 * strictly before today (a Saturday run still reports the week that ended
 * LAST Saturday — today's week isn't over until midnight).
 */
export function lastCompleteWeek(now: Date): { start: string; end: string } {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = day.getUTCDay(); // 0=Sun … 6=Sat
  const backToSaturday = dow === 6 ? 7 : dow + 1;
  const end = new Date(day);
  end.setUTCDate(end.getUTCDate() - backToSaturday);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * The payout draft's idempotency key — one draft per payee per CURRENCY per
 * week-end. `v_payee_balances` is one row per (payee, currency); a key
 * without the currency made the second currency's draft dedupe into the
 * first's pending approval and vanish.
 */
export function payoutDraftKey(
  payeeType: string,
  payeeId: string,
  periodEnd: string,
  currency = "USD",
): string {
  return `payout:${payeeType}:${payeeId}:${currency}:${periodEnd}`;
}
