import { enqueueApproval } from "../governance/approvals.js";
import { resolvePolicy } from "../governance/policy.js";
import { getAdminClient } from "../lib/supabase.js";
import { broadcastStaff, channelsSatisfying } from "../lib/owner.js";
import { getPolicyValue, setPolicyValue } from "../lib/policy-kv.js";
import {
  hermesDict,
  hermesEn as hermesEnDict,
  hermesRu as hermesRuDict,
  money,
} from "../lib/i18n.js";
import { escapeHtml, sendApprovalCard } from "../telegram/api.js";

/**
 * Payday watch — Wednesday is when the studio pays.
 *
 * The earnings week is Sunday–Saturday (the 025 rate-card convention); the
 * money leaves on Wednesday. This job turns that rhythm into at most three
 * kinds of tap:
 *
 *   1. If last week's earnings are not fully posted → ONE close-the-week card,
 *      and no payout drafts — a payout drafted from an understated balance
 *      would idempotency-block its own corrected card, which is strictly
 *      worse than waiting a day.
 *   2. Once the week is posted → one drafted create_payout card per payee with
 *      a positive balance. The draft pays the WHOLE balance (prior weeks
 *      included) — that is the point of paying from balance, not from the
 *      week's number.
 *   3. Once per week, a digest to every staff channel: the week's totals,
 *      per-model breakdown, what's owed, what cards were sent.
 *
 * REGISTERED DAILY, windowed Wed–Saturday inside: Wednesday sends the digest
 * and (usually) the close card; the day Alina approves the close, the NEXT
 * run drafts the payouts from now-accurate balances. A Wednesday-only weekly
 * job would make a Thursday approval wait a week for its payouts.
 *
 * Proposes only. Nothing here writes money — every card goes through
 * decide_approval and the existing executors.
 */

export { isPaydayWindow, lastCompleteWeek, payoutDraftKey } from "./payday-week.js";
import { isPaydayWindow, lastCompleteWeek, payoutDraftKey } from "./payday-week.js";

export async function runPaydayWatch(now: Date = new Date()): Promise<string> {
  if (!isPaydayWindow(now)) return "outside payday window (Wed–Sat)";

  const db = getAdminClient();
  const { start, end } = lastCompleteWeek(now);

  // Is the week fully posted? Same two-query shape as the monthly close watch.
  const { data: weekEarnings, error } = await db
    .from("earnings")
    .select("id, gross_amount, net_amount")
    .gte("period_start", start)
    .lte("period_end", end);
  if (error) throw new Error(`payday watch: ${error.message}`);

  let unposted = 0;
  let weekGross = 0;
  let weekNet = 0;
  if (weekEarnings?.length) {
    const ids = weekEarnings.map((e) => e.id);
    const { data: posted, error: ledgerError } = await db
      .from("ledger_entries")
      .select("earning_id")
      .eq("entry_type", "earning_share")
      .in("earning_id", ids);
    if (ledgerError) throw new Error(`payday watch ledger: ${ledgerError.message}`);
    const closed = new Set((posted ?? []).map((r) => r.earning_id));
    unposted = weekEarnings.filter((e) => !closed.has(e.id)).length;
    weekGross = weekEarnings.reduce((s, e) => s + Number(e.gross_amount ?? 0), 0);
    weekNet = weekEarnings.reduce((s, e) => s + Number(e.net_amount ?? 0), 0);
  }

  let cardsSent = 0;
  let diary: string;

  if (unposted > 0) {
    // Close first; drafts wait for accurate balances. Card only when the
    // proposal is FRESH — this job runs up to four days in a row, and a
    // daily duplicate card for a live approval is noise, not help.
    const { id, deduped } = await enqueueApproval({
      actionType: "close_period",
      payload: { period_start: start, period_end: end },
      preview: {
        summary: hermesEnDict.closeSummary(start, end, unposted),
        summary_en: hermesEnDict.closeSummary(start, end, unposted),
        summary_ru: hermesRuDict.closeSummary(start, end, unposted),
        period: `${start} → ${end}`,
        unclosed_earnings: unposted,
        risk_en: hermesEnDict.closeRisk,
        risk_ru: hermesRuDict.closeRisk,
      },
      riskReason: hermesEnDict.closeRisk,
      jobName: "payday_watch",
      idempotencyKey: `close_period:${start}:${end}`,
    });
    if (!deduped) {
      const requiredRole = resolvePolicy("close_period").requiredRole ?? "super_admin";
      for (const target of await channelsSatisfying(requiredRole)) {
        const h = hermesDict(target.locale);
        const sent = await sendApprovalCard(
          target.chatId,
          id,
          [`<b>${h.closeCardTitle}</b>`, `${start} → ${end}`, h.closeCardBody(unposted, money(weekGross, target.locale))].join("\n"),
          target.locale,
        ).then(() => true, () => false);
        if (sent) cardsSent++;
      }
    }
    diary = `week ${start}..${end} awaiting close (${unposted} unposted); cards ${cardsSent}`;
  } else {
    // Week fully posted (or empty): draft a payout per positive balance.
    const { data: balances, error: balError } = await db
      .from("v_payee_balances")
      .select("payee_type, payee_id, display_name, currency, balance");
    if (balError) throw new Error(`payday watch balances: ${balError.message}`);

    // THE DOUBLE-PAY GUARD (review finding B1). A balance is debited only at
    // SETTLEMENT, so a payee whose last draft is still pending/approved shows
    // the same money in the balance — and next week's key is a new key. Two
    // full-balance drafts for one debt, both approvable. Nobody with ANY open
    // payout gets a new draft; their line waits until the open one settles or
    // is cancelled.
    const { data: openPayouts, error: openError } = await db
      .from("payouts")
      .select("payee_type, payee_id")
      .in("status", ["pending", "approved"]);
    if (openError) throw new Error(`payday watch payouts: ${openError.message}`);
    const hasOpen = new Set((openPayouts ?? []).map((p) => `${p.payee_type}:${p.payee_id}`));

    const owed = (balances ?? []).filter(
      (b) => Number(b.balance ?? 0) > 0 && !hasOpen.has(`${b.payee_type}:${b.payee_id}`),
    );
    const skippedOpen = (balances ?? []).filter(
      (b) => Number(b.balance ?? 0) > 0 && hasOpen.has(`${b.payee_type}:${b.payee_id}`),
    ).length;
    for (const b of owed) {
      const net = Number(b.balance);
      const payee = String(b.display_name ?? "payee");
      const { id, deduped } = await enqueueApproval({
        actionType: "create_payout",
        payload: {
          payee_type: b.payee_type,
          payee_id: b.payee_id,
          period_start: start,
          period_end: end,
          net_amount: net,
          gross_amount: net,
          currency: b.currency ?? "USD",
        },
        preview: {
          summary: hermesEnDict.payoutSummary(payee, net, start, end),
          summary_en: hermesEnDict.payoutSummary(payee, net, start, end),
          summary_ru: hermesRuDict.payoutSummary(payee, net, start, end),
        },
        jobName: "payday_watch",
        idempotencyKey: payoutDraftKey(
          String(b.payee_type),
          String(b.payee_id),
          end,
          String(b.currency ?? "USD"),
        ),
      });
      if (!deduped) {
        const requiredRole = resolvePolicy("create_payout").requiredRole ?? "super_admin";
        for (const target of await channelsSatisfying(requiredRole)) {
          const h = hermesDict(target.locale);
          const sent = await sendApprovalCard(
            target.chatId,
            id,
            [`<b>${h.payoutCardTitle}</b>`, escapeHtml(h.payoutSummary(payee, net, start, end))].join("\n"),
            target.locale,
          ).then(() => true, () => false);
          if (sent) cardsSent++;
        }
      }
    }
    diary = `week ${start}..${end} posted; drafted ${owed.length} payout(s), ${skippedOpen} skipped (open payout); cards ${cardsSent}`;
  }

  // The digest goes out ONCE per week — the first in-window day that runs.
  const digestKey = `payday_digest:${end}`;
  if (!(await getPolicyValue<string>(digestKey))) {
    // Per-model net for the week, resolved to stage names.
    const [accountsRes, modelsRes] = await Promise.all([
      db.from("platform_accounts").select("id, model_id"),
      db.from("models").select("id, stage_name"),
    ]);
    const accountModel = new Map((accountsRes.data ?? []).map((a) => [a.id, a.model_id]));
    const stage = new Map((modelsRes.data ?? []).map((m) => [m.id, m.stage_name]));
    const { data: weekRows } = await db
      .from("earnings")
      .select("platform_account_id, net_amount")
      .gte("period_start", start)
      .lte("period_end", end);
    const perModel = new Map<string, number>();
    for (const r of weekRows ?? []) {
      const modelId = accountModel.get(r.platform_account_id);
      const name = modelId ? (stage.get(modelId) ?? "?") : "?";
      perModel.set(name, (perModel.get(name) ?? 0) + Number(r.net_amount ?? 0));
    }
    const top = [...perModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const { data: balances } = await db
      .from("v_payee_balances")
      .select("balance, currency")
      .gt("balance", 0);
    // Balances are per (payee, currency) — summing across currencies into one
    // "USD" number would be fiction. Partition, render per currency.
    const owedByCurrency = new Map<string, number>();
    for (const b of balances ?? []) {
      const c = String(b.currency ?? "USD");
      owedByCurrency.set(c, (owedByCurrency.get(c) ?? 0) + Number(b.balance ?? 0));
    }
    const owedCount = balances?.length ?? 0;

    // Marker FIRST: a crash mid-broadcast loses one digest (the cards and the
    // diary still exist); marker-after re-sent the whole finance digest daily.
    await setPolicyValue(digestKey, now.toISOString());

    await broadcastStaff(
      (locale) => {
        const h = hermesDict(locale);
        const lines = [
          `<b>${h.paydayTitle(start, end)}</b>`,
          "",
          h.paydayTotals(money(weekGross, locale), money(weekNet, locale)),
        ];
        if (top.length) {
          lines.push(h.paydayPerModel);
          for (const [name, net] of top) {
            lines.push(`• ${escapeHtml(name)} — ${money(net, locale)}`);
          }
        }
        const owedRendered =
          [...owedByCurrency.entries()]
            .map(([c, amount]) => (c === "USD" ? money(amount, locale) : `${amount.toFixed(2)} ${c}`))
            .join(" + ") || money(0, locale);
        lines.push(h.paydayToPay(owedRendered, owedCount));
        if (unposted > 0) lines.push(h.paydayAwaitingClose);
        else if (cardsSent > 0) lines.push(h.paydayCards(cardsSent));
        else if (owedCount === 0) lines.push(h.paydayNothing);
        return lines.join("\n");
      },
      { html: true },
    );
  }

  return diary;
}
