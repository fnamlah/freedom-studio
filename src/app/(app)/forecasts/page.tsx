import type { Metadata } from "next";

import {
  CHART_COLORS,
  LineChartCard,
  OTHER_COLOR,
  StackedBarCard,
  type ChartDatum,
  type ChartSeries,
} from "@/components/charts";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { SnapshotButton } from "./snapshot-button";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).money.forecasts.metaTitle };
}

/* ------------------------------------------------------------------ types --- */

type MonthlyRow = { month: string | null; net_amount: number | null };
type ForecastRow = {
  target_month: string | null;
  model_id: string | null;
  predicted_net: number | null;
};
type DirectoryRow = { id: string | null; stage_name: string | null };
type AccuracyRow = {
  target_month: string | null;
  error_percent: number | null;
  rolling_mape: number | null;
};

/** Keep the actual line readable — most recent year of realized months. */
const ACTUAL_TAIL_MONTHS = 12;
/** Stacked model series before the tail folds into a single "Other" band. */
const TOP_MODELS = 7;
/** Trailing accuracy months shown in the error bar. */
const ACCURACY_TAIL_MONTHS = 6;
/** The "Studio total" bucket for forecast rows with no model scope. */
const STUDIO_KEY = "studio";

/**
 * Forecasts — Super Admin + Manager + Finance (docs/07 §4–5, docs/09 §8).
 *
 * All reads go through the caller's own RLS-scoped session (no service role on any
 * analytics path, docs/07 §6). The projection is the live `v_earnings_forecast`
 * view (MA3 × clamped growth, 3 months ahead by default, docs/09 §8.1) plotted
 * dashed against solid `v_earnings_monthly` actuals. The forecast-accuracy bar and
 * the "Snapshot now" action are money-governance surfaces reserved to SA + FIN
 * (docs/07 §4–5, docs/04 §7.3) — a manager sees the projection and the by-model
 * breakdown, but not accuracy or the snapshot control.
 */
export default async function ForecastsPage() {
  const { supabase, role } = await requireRole("super_admin", "manager", "finance");
  const d = await getDict();
  const fm = fmt(await getLocale());
  const canGovern = role === "super_admin" || role === "finance";

  const [monthlyRes, forecastRes, directoryRes] = await Promise.all([
    supabase
      .from("v_earnings_monthly")
      .select("month, net_amount")
      .order("month", { ascending: true }),
    supabase
      .from("v_earnings_forecast")
      .select("target_month, model_id, predicted_net")
      .order("target_month", { ascending: true }),
    supabase.from("v_model_directory").select("id, stage_name"),
  ]);

  const monthly = (monthlyRes.data ?? []) as MonthlyRow[];
  const forecast = (forecastRes.data ?? []) as ForecastRow[];
  const directory = (directoryRes.data ?? []) as DirectoryRow[];

  // Accuracy joins remembered snapshots against realized earnings (docs/09 §8.2).
  // RLS would let a manager read it, but presentation keeps it SA/FIN-only.
  let accuracy: AccuracyRow[] = [];
  if (canGovern) {
    const { data } = await supabase
      .from("v_forecast_accuracy")
      .select("target_month, error_percent, rolling_mape")
      .is("model_id", null) // studio total; per-model rows carry a non-null model_id
      .order("target_month", { ascending: true });
    accuracy = (data ?? []) as AccuracyRow[];
  }

  /* --------------------------------------------------------------- lookups --- */

  const modelName = new Map<string, string>(
    directory
      .filter((row): row is DirectoryRow & { id: string } => Boolean(row.id))
      .map((row) => [row.id, row.stage_name ?? d.money.forecasts.unknownModel]),
  );

  /* ------------------------------------------------------------ aggregate --- */

  // Actual net per calendar month (summed across model × platform grain).
  const actualByMonth = new Map<string, number>();
  for (const r of monthly) {
    if (!r.month) continue;
    actualByMonth.set(r.month, (actualByMonth.get(r.month) ?? 0) + Number(r.net_amount ?? 0));
  }

  // Projected net: studio total per month, plus a per-model breakdown per month.
  const projByMonth = new Map<string, number>();
  const projByMonthModel = new Map<string, Map<string, number>>();
  const modelTotals = new Map<string, number>();
  for (const r of forecast) {
    if (!r.target_month) continue;
    const value = Number(r.predicted_net ?? 0);
    const modelKey = r.model_id ?? STUDIO_KEY;

    projByMonth.set(r.target_month, (projByMonth.get(r.target_month) ?? 0) + value);

    let inner = projByMonthModel.get(r.target_month);
    if (!inner) {
      inner = new Map<string, number>();
      projByMonthModel.set(r.target_month, inner);
    }
    inner.set(modelKey, (inner.get(modelKey) ?? 0) + value);
    modelTotals.set(modelKey, (modelTotals.get(modelKey) ?? 0) + value);
  }

  const actualMonths = [...actualByMonth.keys()].sort();
  const tailActual = actualMonths.slice(-ACTUAL_TAIL_MONTHS);
  const lastActualMonth = tailActual.length > 0 ? tailActual[tailActual.length - 1] : undefined;

  const forecastMonths = [...projByMonth.keys()]
    .sort()
    .filter((m) => lastActualMonth === undefined || m > lastActualMonth);

  /* -------------------------------- projected vs actual net revenue line --- */

  const lineData: ChartDatum[] = tailActual.map((m) => ({
    month: m,
    net_amount: actualByMonth.get(m) ?? null,
    predicted_net: null,
  }));

  // Anchor the dashed projection to the last actual point so it reads as one
  // revenue line continuing into the future rather than a floating segment.
  if (lineData.length > 0 && lastActualMonth !== undefined) {
    lineData[lineData.length - 1].predicted_net = actualByMonth.get(lastActualMonth) ?? null;
  }
  for (const m of forecastMonths) {
    lineData.push({ month: m, net_amount: null, predicted_net: projByMonth.get(m) ?? null });
  }

  const lineSeries: ChartSeries[] = [
    { key: "net_amount", label: d.money.forecasts.lineActual, color: CHART_COLORS[0] },
    {
      key: "predicted_net",
      label: d.money.forecasts.linePredicted,
      color: CHART_COLORS[0],
      dash: "6 4",
    },
  ];

  /* --------------------------------------- forecast breakdown by model ----- */

  const rankedModels = [...modelTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topModelKeys = rankedModels.slice(0, TOP_MODELS).map(([key]) => key);
  const topModelSet = new Set(topModelKeys);
  const hasOtherModels = rankedModels.length > TOP_MODELS;

  const breakdownData: ChartDatum[] = forecastMonths.map((m) => {
    const inner = projByMonthModel.get(m) ?? new Map<string, number>();
    const row: ChartDatum = { month: m };
    let other = 0;
    for (const [key, value] of inner) {
      if (topModelSet.has(key)) row[key] = value;
      else other += value;
    }
    if (hasOtherModels) row.other = other;
    return row;
  });

  const labelForModelKey = (key: string) =>
    key === STUDIO_KEY
      ? d.money.forecasts.studioTotal
      : modelName.get(key) ?? d.money.forecasts.unknownModel;

  const breakdownSeries: ChartSeries[] = topModelKeys.map((key, index) => ({
    key,
    label: labelForModelKey(key),
    color: CHART_COLORS[index],
  }));
  if (hasOtherModels) {
    breakdownSeries.push({ key: "other", label: d.money.forecasts.otherModels, color: OTHER_COLOR });
  }

  /* -------------------------------------------- forecast accuracy bar ------ */

  const accuracyData: ChartDatum[] = accuracy
    .slice(-ACCURACY_TAIL_MONTHS)
    .map((r) => ({ month: r.target_month, error_percent: r.error_percent }));
  const accuracySeries: ChartSeries[] = [
    { key: "error_percent", label: d.money.forecasts.accuracyError, color: CHART_COLORS[3] },
  ];

  /* ------------------------------------------------------------ stat tiles --- */

  const firstForecastMonth = forecastMonths.length > 0 ? forecastMonths[0] : undefined;
  const nextMonthProjected =
    firstForecastMonth !== undefined ? projByMonth.get(firstForecastMonth) ?? 0 : null;
  const horizonProjected = [...projByMonth.values()].reduce((sum, v) => sum + v, 0);
  const lastActualNet =
    lastActualMonth !== undefined ? actualByMonth.get(lastActualMonth) ?? 0 : null;
  const latestMape =
    accuracy.length > 0 ? accuracy[accuracy.length - 1].rolling_mape : null;

  const isEmpty = monthly.length === 0 && forecast.length === 0;

  /* ---------------------------------------------------------------- render --- */

  return (
    <>
      <PageHeader
        title={d.money.forecasts.title}
        description={d.money.forecasts.description}
        breadcrumbs={[{ label: d.money.forecasts.title }]}
        actions={canGovern ? <SnapshotButton /> : undefined}
      />

      {isEmpty ? (
        <EmptyState
          title={d.money.forecasts.emptyTitle}
          description={d.money.forecasts.emptyDesc}
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={canGovern ? 4 : 3}>
            <StatTile
              label={d.money.forecasts.nextMonthProjected}
              value={nextMonthProjected === null ? "—" : fm.money(nextMonthProjected)}
              hint={
                firstForecastMonth ? fm.month(firstForecastMonth) : d.money.forecasts.noHorizon
              }
            />
            <StatTile
              label={d.money.forecasts.projectedHorizon}
              value={fm.money(horizonProjected)}
              hint={d.money.forecasts.nextMonths(forecastMonths.length || 3)}
            />
            <StatTile
              label={d.money.forecasts.lastActualNet}
              value={lastActualNet === null ? "—" : fm.money(lastActualNet)}
              hint={
                lastActualMonth ? fm.month(lastActualMonth) : d.money.forecasts.noEarningsYet
              }
            />
            {canGovern ? (
              <StatTile
                label={d.money.forecasts.rollingMape}
                value={latestMape === null ? "—" : fm.percent(latestMape)}
                hint={
                  accuracy.length > 0
                    ? d.money.forecasts.mapeHint
                    : d.money.forecasts.mapeEmptyHint
                }
              />
            ) : null}
          </StatTileRow>

          <div className="mb-6">
            <LineChartCard
              title={d.money.forecasts.lineTitle}
              description={d.money.forecasts.lineDesc}
              data={lineData}
              xKey="month"
              series={lineSeries}
              connectNulls
              valueFormat="money"
              xFormat="month"
              emptyMessage={d.money.forecasts.lineEmpty}
            />
          </div>

          <div className={canGovern ? "grid gap-6 lg:grid-cols-2" : ""}>
            <StackedBarCard
              title={d.money.forecasts.breakdownTitle}
              description={d.money.forecasts.breakdownDesc(forecastMonths.length || 3)}
              data={breakdownData}
              xKey="month"
              series={breakdownSeries}
              valueFormat="money"
              xFormat="month"
              emptyMessage={d.money.forecasts.breakdownEmpty}
            />

            {canGovern ? (
              <StackedBarCard
                title={d.money.forecasts.accuracyTitle}
                description={d.money.forecasts.accuracyDesc}
                data={accuracyData}
                xKey="month"
                series={accuracySeries}
                showTotal={false}
                valueFormat="percent-signed"
                xFormat="month"
                emptyMessage={d.money.forecasts.accuracyEmpty}
              />
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
