/**
 * Dashboard data layer (M11 — docs/07-analytics.md §2–§5).
 *
 * Every read here goes through the CALLER's session (`createServerSupabase` /
 * the `supabase` handed back by `requireUser()`), never a service-role client.
 * The analytics views and RPCs are all SECURITY INVOKER (docs/07 §1), so the
 * rows a loader receives are already scoped to the signed-in user by RLS — the
 * per-role split below is a *presentation* decision (which widgets to render and
 * which queries to even issue), layered on top of a DB boundary that is the real
 * authority. Notably an operator loader never touches `earnings`/`work_sessions`
 * at all (docs/07 §5): its dashboard is derived only from its own ledger + payouts.
 */

import type { ChartDatum, ChartSeries } from "@/components/charts/chart-frame";
import type { HorizontalBarDatum } from "@/components/charts/horizontal-bar-card";
import {
  CHART_COLORS,
  OTHER_COLOR,
  STATUS_COLORS,
  type SliceDatum,
} from "@/components/charts/theme";
import type { Enums } from "@/lib/database.types";
import type { ServerSupabaseClient } from "@/lib/supabase/server";

/* ------------------------------------------------------------------ shared */

type PayoutStatus = Enums<"payout_status">;

/** Fixed status order used everywhere payouts are broken out by status. */
export const PAYOUT_STATUS_ORDER: readonly PayoutStatus[] = [
  "pending",
  "approved",
  "paid",
  "cancelled",
];

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  cancelled: "Cancelled",
};

/**
 * Payout status is a good/bad signal, so status tokens are sanctioned here
 * (theme rule: status colours only where colour *means* status). "Approved" has
 * no status token, so it borrows categorical slot 1 — the one non-status hue.
 */
export const PAYOUT_STATUS_COLOR: Record<PayoutStatus, string> = {
  pending: STATUS_COLORS.warning,
  approved: CHART_COLORS[0],
  paid: STATUS_COLORS.success,
  cancelled: STATUS_COLORS.danger,
};

const SPLIT_BUCKET_LABEL: Record<string, string> = {
  studio: "Studio",
  model: "Model pool",
  operator: "Operator pool",
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Normalise any date-ish value to a `YYYY-MM-01` month key, or null. */
function monthKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const ym = value.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : null;
}

function sortedMonths(map: Map<string, unknown>): string[] {
  return [...map.keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * Rolling window anchored on the current UTC month (format.ts renders in UTC, so
 * month keys line up with the axis labels). 12 months of history for trends; the
 * current and previous month for period KPIs and the model-vs-model comparison.
 */
export function dashboardWindow(now: Date = new Date()) {
  const monthStart = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
      .toISOString()
      .slice(0, 10);
  return {
    trendFrom: monthStart(-11),
    currentMonth: monthStart(0),
    prevMonth: monthStart(-1),
  };
}

/* -------------------------------------------------------------- row shapes */

type EarnMonthRow = { month: string | null; gross_amount: number | null; net_amount: number | null };
type ShareModelRow = { month: string | null; stage_name: string | null; net_amount: number | null };
type SharePlatRow = { month: string | null; platform_name: string | null; net_amount: number | null };
type HoursRow = { month: string | null; hours: number | null; session_count: number | null };
type ForecastRow = { target_month: string | null; model_id: string | null; predicted_net: number | null };
type AccuracyRow = {
  target_month: string | null;
  model_id: string | null;
  error_percent: number | null;
};
type SplitRow = { month: string | null; bucket: string | null; amount: number | null };
type BalanceRow = {
  payee_type: Enums<"payee_type"> | null;
  payee_id: string | null;
  display_name: string | null;
  currency: string | null;
  balance: number | null;
};
type PayoutRow = {
  payout_id: string | null;
  payee_name: string | null;
  payee_type: Enums<"payee_type"> | null;
  net_amount: number | null;
  currency: string | null;
  status: PayoutStatus | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
};
type LedgerShareRow = {
  amount: number | null;
  currency: string | null;
  period_start: string | null;
  created_at: string | null;
};

/** Public view row shapes reused by the page for tables. */
export type PayoutHistoryRow = PayoutRow;
export type PayeeBalanceRow = BalanceRow;
export type AiReportRow = {
  id: string;
  title: string;
  report_month: string;
  content_md: string;
  created_at: string;
  provider: Enums<"ai_provider">;
  model: string;
};

/* --------------------------------------------------------- aggregations */

function earningsTrend(rows: EarnMonthRow[]): ChartDatum[] {
  const net = new Map<string, number>();
  const gross = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(r.month);
    if (!k) continue;
    net.set(k, (net.get(k) ?? 0) + num(r.net_amount));
    gross.set(k, (gross.get(k) ?? 0) + num(r.gross_amount));
  }
  return sortedMonths(net).map((month) => ({
    month,
    net: net.get(month) ?? 0,
    gross: gross.get(month) ?? 0,
  }));
}

function hoursTrend(rows: HoursRow[]): ChartDatum[] {
  const hours = new Map<string, number>();
  const sessions = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(r.month);
    if (!k) continue;
    hours.set(k, (hours.get(k) ?? 0) + num(r.hours));
    sessions.set(k, (sessions.get(k) ?? 0) + num(r.session_count));
  }
  return sortedMonths(hours).map((month) => ({
    month,
    hours: hours.get(month) ?? 0,
    sessions: sessions.get(month) ?? 0,
  }));
}

/** Aggregate a share view into pie slices keyed by a name column. */
function shareSlices<T extends { net_amount: number | null }>(
  rows: T[],
  nameOf: (row: T) => string | null,
): SliceDatum[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const name = (nameOf(r) ?? "").trim() || "Unattributed";
    totals.set(name, (totals.get(name) ?? 0) + num(r.net_amount));
  }
  return [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

function splitSlices(rows: SplitRow[]): SliceDatum[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = (r.bucket ?? "").toLowerCase();
    const name = SPLIT_BUCKET_LABEL[key] ?? (r.bucket ?? "Other");
    totals.set(name, (totals.get(name) ?? 0) + num(r.amount));
  }
  return [...totals.entries()]
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
}

/** Ledger `earning_share` credits folded into a monthly net line (operators). */
function ledgerShareTrend(rows: LedgerShareRow[]): ChartDatum[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(r.period_start ?? r.created_at);
    if (!k) continue;
    totals.set(k, (totals.get(k) ?? 0) + num(r.amount));
  }
  return sortedMonths(totals)
    .slice(-12)
    .map((month) => ({ month, share: totals.get(month) ?? 0 }));
}

/** Payout history → stacked-by-status columns over the months present. */
function payoutStacks(rows: PayoutRow[]): { data: ChartDatum[]; series: ChartSeries[] } {
  const byMonth = new Map<string, Record<PayoutStatus, number>>();
  const present = new Set<PayoutStatus>();
  for (const r of rows) {
    const k = monthKey(r.paid_at ?? r.period_end ?? r.period_start);
    if (!k || !r.status) continue;
    const bucket =
      byMonth.get(k) ?? { pending: 0, approved: 0, paid: 0, cancelled: 0 };
    bucket[r.status] += num(r.net_amount);
    byMonth.set(k, bucket);
    present.add(r.status);
  }
  const data: ChartDatum[] = sortedMonths(byMonth).map((month) => ({
    month,
    ...byMonth.get(month),
  }));
  const series: ChartSeries[] = PAYOUT_STATUS_ORDER.filter((s) => present.has(s)).map(
    (status) => ({
      key: status,
      label: PAYOUT_STATUS_LABEL[status],
      color: PAYOUT_STATUS_COLOR[status],
    }),
  );
  return { data, series };
}

/** Historical actual (solid) merged with the live forecast (dashed). */
function projectedVsActual(earn: EarnMonthRow[], forecast: ForecastRow[]): ChartDatum[] {
  const actual = new Map<string, number>();
  for (const r of earn) {
    const k = monthKey(r.month);
    if (!k) continue;
    actual.set(k, (actual.get(k) ?? 0) + num(r.net_amount));
  }
  const predicted = new Map<string, number>();
  for (const r of forecast) {
    const k = monthKey(r.target_month);
    if (!k) continue;
    predicted.set(k, (predicted.get(k) ?? 0) + num(r.predicted_net));
  }
  const months = [...new Set([...actual.keys(), ...predicted.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  // Bridge the dashed line onto the last actual point so it does not float.
  const lastActual = [...actual.keys()].sort((a, b) => a.localeCompare(b)).at(-1);
  return months.map((month) => {
    const row: ChartDatum = { month };
    if (actual.has(month)) row.actual = actual.get(month) ?? 0;
    if (predicted.has(month)) row.predicted = predicted.get(month) ?? 0;
    if (month === lastActual && !predicted.has(month)) row.predicted = actual.get(month) ?? 0;
    return row;
  });
}

/** Forecast breakdown: months × top models stacked, tail folded into "Other". */
function forecastBreakdown(
  forecast: ForecastRow[],
  modelNames: Map<string, string>,
  topN = 5,
): { data: ChartDatum[]; series: ChartSeries[] } {
  const perModel = new Map<string, number>();
  const perMonthModel = new Map<string, Map<string, number>>();
  for (const r of forecast) {
    const month = monthKey(r.target_month);
    if (!month || !r.model_id) continue;
    perModel.set(r.model_id, (perModel.get(r.model_id) ?? 0) + num(r.predicted_net));
    const inner = perMonthModel.get(month) ?? new Map<string, number>();
    inner.set(r.model_id, (inner.get(r.model_id) ?? 0) + num(r.predicted_net));
    perMonthModel.set(month, inner);
  }
  const top = [...perModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id]) => id);
  const topSet = new Set(top);
  const hasOther = perModel.size > top.length;

  const data: ChartDatum[] = sortedMonths(perMonthModel).map((month) => {
    const inner = perMonthModel.get(month)!;
    const row: ChartDatum = { month };
    let other = 0;
    for (const [id, value] of inner) {
      if (topSet.has(id)) row[id] = value;
      else other += value;
    }
    if (hasOther) row.__other = other;
    return row;
  });

  const series: ChartSeries[] = top.map((id) => ({
    key: id,
    label: modelNames.get(id) ?? "Model",
  }));
  if (hasOther) series.push({ key: "__other", label: "Other", color: OTHER_COLOR });
  return { data, series };
}

/** Studio-wide forecast error % (model_id IS NULL rows), trailing 3 months. */
function accuracyBars(rows: AccuracyRow[]): ChartDatum[] {
  return rows
    .filter((r) => r.model_id === null && r.target_month)
    .map((r) => ({ month: monthKey(r.target_month)!, error: num(r.error_percent) }))
    .filter((r) => r.month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-3);
}

function balanceBars(rows: BalanceRow[]): HorizontalBarDatum[] {
  return rows
    .filter((r) => r.payee_id)
    .map((r) => ({
      name: (r.display_name ?? "").trim() || "Payee",
      value: num(r.balance),
    }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value);
}

/** Net by model, this month vs last month, top 6 by current month. */
function modelComparison(
  rows: ShareModelRow[],
  currentMonth: string,
  prevMonth: string,
): { data: ChartDatum[]; series: ChartSeries[] } {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  for (const r of rows) {
    const k = monthKey(r.month);
    const name = (r.stage_name ?? "").trim() || "Model";
    if (k === currentMonth) current.set(name, (current.get(name) ?? 0) + num(r.net_amount));
    else if (k === prevMonth) previous.set(name, (previous.get(name) ?? 0) + num(r.net_amount));
  }
  const names = [...new Set([...current.keys(), ...previous.keys()])]
    .sort((a, b) => (current.get(b) ?? 0) - (current.get(a) ?? 0))
    .slice(0, 6);
  const data: ChartDatum[] = names.map((name) => ({
    name,
    current: current.get(name) ?? 0,
    previous: previous.get(name) ?? 0,
  }));
  const series: ChartSeries[] = [
    { key: "current", label: "This month" },
    { key: "previous", label: "Last month" },
  ];
  return { data, series };
}

type LibraryLiteRow = { id: string; category_id: string | null; ai_status: string };

export type LibraryCard = {
  total: number;
  analyzed: number;
  awaitingReview: number;
  unreadable: number;
  topCategories: Array<{ name: string; count: number }>;
};

/**
 * Library knowledge-base rollup. "Analyzed" is everything the AI produced a
 * summary state for (suggested + human-settled); "awaiting review" counts
 * suggestions no human has confirmed or overridden yet.
 */
function libraryCard(
  rows: LibraryLiteRow[],
  cats: Array<{ id: string; name: string }>,
): LibraryCard {
  const byCat = new Map<string, number>();
  let analyzed = 0;
  let awaitingReview = 0;
  let unreadable = 0;
  for (const r of rows) {
    if (r.ai_status === "suggested") {
      analyzed += 1;
      awaitingReview += 1;
    } else if (r.ai_status === "confirmed" || r.ai_status === "overridden") {
      analyzed += 1;
    } else if (r.ai_status === "skipped" || r.ai_status === "failed") {
      unreadable += 1;
    }
    if (r.category_id) byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + 1);
  }
  const names = new Map(cats.map((c) => [c.id, c.name] as const));
  const topCategories = [...byCat.entries()]
    .map(([id, count]) => ({ name: names.get(id) ?? "Uncategorised", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  return { total: rows.length, analyzed, awaitingReview, unreadable, topCategories };
}

function monthTotal(rows: EarnMonthRow[], month: string) {
  let gross = 0;
  let net = 0;
  for (const r of rows) {
    if (monthKey(r.month) === month) {
      gross += num(r.gross_amount);
      net += num(r.net_amount);
    }
  }
  return { gross, net };
}

function hoursTotal(rows: HoursRow[], month: string): number {
  let hours = 0;
  for (const r of rows) if (monthKey(r.month) === month) hours += num(r.hours);
  return hours;
}

function pendingPayouts(rows: PayoutRow[]): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (r.status === "pending") {
      count += 1;
      total += num(r.net_amount);
    }
  }
  return { count, total };
}

/** Currency shown on money tiles — first one seen, defaulting to USD. */
function firstCurrency(
  ...sources: { currency: string | null }[][]
): string {
  for (const rows of sources) {
    for (const r of rows) if (r.currency) return r.currency;
  }
  return "USD";
}

/* --------------------------------------------------------------- loaders */

/**
 * Super Admin & Studio Manager (docs/07 §5). Both are studio-wide; the manager
 * omits the money-governance widgets (split distribution, forecast accuracy,
 * payee balances, AI insight), so those queries are only issued when
 * `governance` is set — no wasted round-trips for a manager.
 */
export async function loadStudioDashboard(
  supabase: ServerSupabaseClient,
  { governance }: { governance: boolean },
) {
  const { trendFrom, currentMonth, prevMonth } = dashboardWindow();

  const [
    earnMonthly,
    shareModel,
    sharePlatform,
    hours,
    payouts,
    compliance,
    forecast,
    modelDir,
    library,
    libraryCats,
    split,
    accuracy,
    balances,
    aiReport,
  ] = await Promise.all([
    supabase.from("v_earnings_monthly").select("month, gross_amount, net_amount").gte("month", trendFrom),
    supabase.from("v_earnings_share_by_model").select("month, stage_name, net_amount").gte("month", trendFrom),
    supabase.from("v_earnings_share_by_platform").select("month, platform_name, net_amount").gte("month", trendFrom),
    supabase.from("v_sessions_hours_monthly").select("month, hours, session_count").gte("month", trendFrom),
    supabase.from("v_payout_history").select("payout_id, payee_name, payee_type, net_amount, currency, status, paid_at, period_start, period_end"),
    supabase.rpc("fn_compliance_counts"),
    supabase.from("v_earnings_forecast").select("target_month, model_id, predicted_net"),
    supabase.from("v_model_directory").select("id, stage_name"),
    // Library knowledge base — RLS scopes it to SA/MGR; other roles read zero
    // rows and the card renders empty rather than erroring.
    supabase.from("library_files").select("id, category_id, ai_status"),
    supabase.from("doc_categories").select("id, name"),
    governance
      ? supabase.from("v_split_distribution").select("month, bucket, amount").gte("month", trendFrom)
      : Promise.resolve({ data: [] as SplitRow[] }),
    governance
      ? supabase.from("v_forecast_accuracy").select("target_month, model_id, error_percent")
      : Promise.resolve({ data: [] as AccuracyRow[] }),
    governance
      ? supabase.from("v_payee_balances").select("payee_type, payee_id, display_name, currency, balance")
      : Promise.resolve({ data: [] as BalanceRow[] }),
    governance
      ? supabase.from("ai_reports").select("id, title, report_month, content_md, created_at, provider, model").order("report_month", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as AiReportRow[] }),
  ]);

  const earnRows = (earnMonthly.data ?? []) as EarnMonthRow[];
  const shareModelRows = (shareModel.data ?? []) as ShareModelRow[];
  const payoutRows = (payouts.data ?? []) as PayoutRow[];
  const complianceRow = (compliance.data ?? [])[0] as
    | { valid_count: number; expiring_count: number; expired_count: number }
    | undefined;
  const forecastRows = (forecast.data ?? []) as ForecastRow[];
  const modelNames = new Map(
    ((modelDir.data ?? []) as { id: string | null; stage_name: string | null }[])
      .filter((m) => m.id)
      .map((m) => [m.id as string, m.stage_name ?? "Model"]),
  );

  const period = monthTotal(earnRows, currentMonth);
  const pending = pendingPayouts(payoutRows);

  return {
    currency: firstCurrency(payoutRows),
    kpis: {
      periodGross: period.gross,
      periodNet: period.net,
      periodHours: hoursTotal((hours.data ?? []) as HoursRow[], currentMonth),
      pendingCount: pending.count,
      pendingTotal: pending.total,
    },
    earningsTrend: earningsTrend(earnRows),
    hoursTrend: hoursTrend((hours.data ?? []) as HoursRow[]),
    shareByModel: shareSlices(shareModelRows, (r: ShareModelRow) => r.stage_name),
    shareByPlatform: shareSlices((sharePlatform.data ?? []) as SharePlatRow[], (r: SharePlatRow) => r.platform_name),
    modelComparison: modelComparison(shareModelRows, currentMonth, prevMonth),
    payouts: payoutStacks(payoutRows),
    payoutRows,
    compliance: complianceRow ?? { valid_count: 0, expiring_count: 0, expired_count: 0 },
    library: libraryCard(
      (library.data ?? []) as LibraryLiteRow[],
      (libraryCats.data ?? []) as { id: string; name: string }[],
    ),
    projectedVsActual: projectedVsActual(earnRows, forecastRows),
    forecastBreakdown: forecastBreakdown(forecastRows, modelNames),
    // governance-only
    split: splitSlices((split.data ?? []) as SplitRow[]),
    accuracy: accuracyBars((accuracy.data ?? []) as AccuracyRow[]),
    balances: balanceBars((balances.data ?? []) as BalanceRow[]),
    aiReport: ((aiReport.data ?? []) as AiReportRow[])[0] ?? null,
  };
}

/** Finance/Accountant (docs/07 §5): money only, studio-wide, no compliance. */
export async function loadFinanceDashboard(supabase: ServerSupabaseClient) {
  const { trendFrom, currentMonth } = dashboardWindow();

  const [earnMonthly, forecast, modelDir, split, accuracy, payouts, balances, aiReport] =
    await Promise.all([
      supabase.from("v_earnings_monthly").select("month, gross_amount, net_amount").gte("month", trendFrom),
      supabase.from("v_earnings_forecast").select("target_month, model_id, predicted_net"),
      supabase.from("v_model_directory").select("id, stage_name"),
      supabase.from("v_split_distribution").select("month, bucket, amount").gte("month", trendFrom),
      supabase.from("v_forecast_accuracy").select("target_month, model_id, error_percent"),
      supabase.from("v_payout_history").select("payout_id, payee_name, payee_type, net_amount, currency, status, paid_at, period_start, period_end"),
      supabase.from("v_payee_balances").select("payee_type, payee_id, display_name, currency, balance"),
      supabase.from("ai_reports").select("id, title, report_month, content_md, created_at, provider, model").order("report_month", { ascending: false }).limit(1),
    ]);

  const earnRows = (earnMonthly.data ?? []) as EarnMonthRow[];
  const forecastRows = (forecast.data ?? []) as ForecastRow[];
  const payoutRows = (payouts.data ?? []) as PayoutRow[];
  const balanceRows = (balances.data ?? []) as BalanceRow[];
  const modelNames = new Map(
    ((modelDir.data ?? []) as { id: string | null; stage_name: string | null }[])
      .filter((m) => m.id)
      .map((m) => [m.id as string, m.stage_name ?? "Model"]),
  );

  const period = monthTotal(earnRows, currentMonth);
  const pending = pendingPayouts(payoutRows);
  const outstanding = balanceRows.reduce((sum, r) => sum + num(r.balance), 0);

  return {
    currency: firstCurrency(payoutRows, balanceRows),
    kpis: {
      periodGross: period.gross,
      periodNet: period.net,
      pendingCount: pending.count,
      pendingTotal: pending.total,
      outstanding,
    },
    earningsTrend: earningsTrend(earnRows),
    projectedVsActual: projectedVsActual(earnRows, forecastRows),
    forecastBreakdown: forecastBreakdown(forecastRows, modelNames),
    split: splitSlices((split.data ?? []) as SplitRow[]),
    accuracy: accuracyBars((accuracy.data ?? []) as AccuracyRow[]),
    payouts: payoutStacks(payoutRows),
    payoutRows,
    balances: balanceBars(balanceRows),
    aiReport: ((aiReport.data ?? []) as AiReportRow[])[0] ?? null,
  };
}

/** Model (docs/07 §5): own data only — earnings/hours/platform share/payouts/compliance. */
export async function loadModelDashboard(supabase: ServerSupabaseClient) {
  const { trendFrom, currentMonth } = dashboardWindow();

  const [earnMonthly, sharePlatform, hours, payouts, compliance] = await Promise.all([
    supabase.from("v_earnings_monthly").select("month, gross_amount, net_amount").gte("month", trendFrom),
    supabase.from("v_earnings_share_by_platform").select("month, platform_name, net_amount").gte("month", trendFrom),
    supabase.from("v_sessions_hours_monthly").select("month, hours, session_count").gte("month", trendFrom),
    supabase.from("v_payout_history").select("payout_id, payee_name, payee_type, net_amount, currency, status, paid_at, period_start, period_end"),
    supabase.rpc("fn_compliance_counts"),
  ]);

  const earnRows = (earnMonthly.data ?? []) as EarnMonthRow[];
  const hoursRows = (hours.data ?? []) as HoursRow[];
  const payoutRows = (payouts.data ?? []) as PayoutRow[];
  const complianceRow = (compliance.data ?? [])[0] as
    | { valid_count: number; expiring_count: number; expired_count: number }
    | undefined;

  const period = monthTotal(earnRows, currentMonth);
  const pending = pendingPayouts(payoutRows);

  return {
    currency: firstCurrency(payoutRows),
    kpis: {
      periodGross: period.gross,
      periodNet: period.net,
      periodHours: hoursTotal(hoursRows, currentMonth),
      pendingCount: pending.count,
      pendingTotal: pending.total,
    },
    earningsTrend: earningsTrend(earnRows),
    hoursTrend: hoursTrend(hoursRows),
    shareByPlatform: shareSlices((sharePlatform.data ?? []) as SharePlatRow[], (r: SharePlatRow) => r.platform_name),
    payouts: payoutStacks(payoutRows),
    payoutRows,
    compliance: complianceRow ?? { valid_count: 0, expiring_count: 0, expired_count: 0 },
  };
}

/**
 * Operator (docs/07 §5): own ledger + payouts ONLY. Never touches `earnings` or
 * `work_sessions` — the share trend is built from this operator's own
 * `ledger_entries` `earning_share` credits, and the balance from `v_payee_balances`.
 */
export async function loadOperatorDashboard(supabase: ServerSupabaseClient) {
  const { currentMonth } = dashboardWindow();

  const [ledger, payouts, balances] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("amount, currency, period_start, created_at")
      .eq("entry_type", "earning_share"),
    supabase.from("v_payout_history").select("payout_id, payee_name, payee_type, net_amount, currency, status, paid_at, period_start, period_end"),
    supabase.from("v_payee_balances").select("payee_type, payee_id, display_name, currency, balance"),
  ]);

  const ledgerRows = (ledger.data ?? []) as LedgerShareRow[];
  const payoutRows = (payouts.data ?? []) as PayoutRow[];
  const balanceRows = (balances.data ?? []) as BalanceRow[];

  const balance = balanceRows.reduce((sum, r) => sum + num(r.balance), 0);
  const pending = pendingPayouts(payoutRows);
  const periodShare = ledgerRows.reduce(
    (sum, r) => (monthKey(r.period_start ?? r.created_at) === currentMonth ? sum + num(r.amount) : sum),
    0,
  );

  return {
    currency: firstCurrency(balanceRows, payoutRows, ledgerRows),
    kpis: { balance, pendingCount: pending.count, pendingTotal: pending.total, periodShare },
    shareTrend: ledgerShareTrend(ledgerRows),
    payouts: payoutStacks(payoutRows),
    payoutRows,
  };
}
