import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  DonutChartCard,
  GroupedBarCard,
  HorizontalBarCard,
  LineChartCard,
  PieChartCard,
  StackedBarCard,
} from "@/components/charts";
import { STATUS_COLORS } from "@/components/charts/theme";
import { AiInsightPanel } from "@/components/dashboard/ai-insight-panel";
import { PayoutTable } from "@/components/dashboard/payout-table";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireUser } from "@/lib/auth/guard";
import type { Dictionary } from "@/lib/i18n";
import { fmt, type Formatters } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import {
  loadFinanceDashboard,
  loadModelDashboard,
  loadOperatorDashboard,
  loadStudioDashboard,
} from "./data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).money.dashboard.metaTitle };
}

/* ------------------------------------------------------------- formatters */

/**
 * Every widget below needs both the dictionary and the locale-bound formatters,
 * so they travel together as one bundle rather than as two threaded params.
 */
type Ctx = { d: Dictionary; fm: Formatters };

const fmtNumber = (fm: Formatters, value: number) =>
  fm.number(value, { decimals: Number.isInteger(value) ? 0 : 1 });

/** The hours KPI: a localized number plus the translated unit ("h" / "ч"). */
const fmtHoursTile = ({ d, fm }: Ctx, value: number) =>
  `${fm.number(value, { decimals: 1 })} ${d.money.dashboard.hoursUnit}`;

function moneyFmt(fm: Formatters, currency: string) {
  return (value: number) => fm.money(value, currency);
}

/**
 * Compliance is a STATUS chart, so its slices are coloured by name — and the
 * names are now translated, so the colour map is keyed off the same dictionary
 * values the slices carry.
 */
function complianceView(
  { d }: Ctx,
  counts: { valid_count: number; expiring_count: number; expired_count: number },
) {
  const { complianceValid, complianceExpiring, complianceExpired } = d.money.dashboard;
  return {
    slices: [
      { name: complianceValid, value: counts.valid_count },
      { name: complianceExpiring, value: counts.expiring_count },
      { name: complianceExpired, value: counts.expired_count },
    ],
    colors: {
      [complianceValid]: STATUS_COLORS.success,
      [complianceExpiring]: STATUS_COLORS.warning,
      [complianceExpired]: STATUS_COLORS.danger,
    } as Record<string, string>,
    total: counts.valid_count + counts.expiring_count + counts.expired_count,
  };
}

/** Two-column responsive grid for chart cards. */
/**
 * Library knowledge-base rollup (SA/MGR studio view). Numbers come from the
 * caller's own RLS read of library_files — roles without library access simply
 * see an empty card path never rendered (the studio view is SA/MGR only).
 */
function LibraryCardView({
  ctx,
  library,
}: {
  ctx: Ctx;
  library: Awaited<ReturnType<typeof loadStudioDashboard>>["library"];
}) {
  const { d, fm } = ctx;
  return (
    <Card>
      <CardHeader
        title={d.money.dashboard.libraryTitle}
        description={d.money.dashboard.libraryDesc}
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">{d.money.dashboard.libraryFiles}</dt>
            <dd className="text-xl font-semibold text-foreground">
              {fmtNumber(fm, library.total)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{d.money.dashboard.libraryAnalyzed}</dt>
            <dd className="text-xl font-semibold text-foreground">
              {fmtNumber(fm, library.analyzed)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{d.money.dashboard.libraryAwaitingReview}</dt>
            <dd className="text-xl font-semibold text-foreground">
              {fmtNumber(fm, library.awaitingReview)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{d.money.dashboard.libraryUnreadable}</dt>
            <dd className="text-xl font-semibold text-foreground">
              {fmtNumber(fm, library.unreadable)}
            </dd>
          </div>
        </dl>
        {library.topCategories.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            {library.topCategories.map((c) => (
              <li key={c.name} className="flex justify-between">
                <span className="text-muted">{c.name}</span>
                <span className="font-medium text-foreground">{fmtNumber(fm, c.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">{children}</div>;
}

/* ------------------------------------------------------------------- page */

/**
 * Per-role dashboard composition (docs/07-analytics.md §5). The page renders a
 * different widget set per role, but the data behind every widget comes from the
 * SECURITY INVOKER views/RPCs read with the caller's own session — RLS is the
 * real scope boundary, this switch is only presentation (docs/07 §1, §4).
 */
export default async function DashboardPage() {
  const { supabase, profile, role } = await requireUser();
  const d = await getDict();
  const ctx: Ctx = { d, fm: fmt(await getLocale()) };

  const header = (
    <PageHeader
      title={d.money.dashboard.welcome(profile.full_name.split(" ")[0])}
      description={d.money.dashboard.signedInAs(d.roles[role])}
    />
  );

  if (role === "super_admin" || role === "manager") {
    const governance = role === "super_admin";
    const data = await loadStudioDashboard(supabase, { governance, d });
    return (
      <>
        {header}
        <StudioDashboard ctx={ctx} data={data} governance={governance} />
      </>
    );
  }

  if (role === "finance") {
    const data = await loadFinanceDashboard(supabase, d);
    return (
      <>
        {header}
        <FinanceDashboard ctx={ctx} data={data} />
      </>
    );
  }

  if (role === "model") {
    const data = await loadModelDashboard(supabase, d);
    return (
      <>
        {header}
        <ModelDashboard ctx={ctx} data={data} />
      </>
    );
  }

  const data = await loadOperatorDashboard(supabase, d);
  return (
    <>
      {header}
      <OperatorDashboard ctx={ctx} data={data} />
    </>
  );
}

/* --------------------------------------------------------- Studio (SA/MGR) */

function StudioDashboard({
  ctx,
  data,
  governance,
}: {
  ctx: Ctx;
  data: Awaited<ReturnType<typeof loadStudioDashboard>>;
  governance: boolean;
}) {
  const { d, fm } = ctx;
  const fmtMoney = moneyFmt(fm, data.currency);
  const compliance = complianceView(ctx, data.compliance);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile
          label={d.money.dashboard.grossRevenue}
          value={fmtMoney(data.kpis.periodGross)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.netRevenue}
          value={fmtMoney(data.kpis.periodNet)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.hoursWorked}
          value={fmtHoursTile(ctx, data.kpis.periodHours)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.pendingPayouts}
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={d.money.dashboard.awaiting(data.kpis.pendingCount)}
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title={d.money.dashboard.earningsTrendTitle}
        description={d.money.dashboard.earningsTrendDesc}
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: d.money.dashboard.seriesNet },
          { key: "gross", label: d.money.dashboard.seriesGross },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title={d.money.dashboard.shareByModelTitle}
          description={d.money.dashboard.shareByModelDesc}
          data={data.shareByModel}
          valueFormat={{ money: data.currency }}
        />
        <PieChartCard
          title={d.money.dashboard.shareByPlatformTitle}
          description={d.money.dashboard.shareByPlatformDesc}
          data={data.shareByPlatform}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title={d.money.dashboard.hoursSessionsTitle}
          description={d.money.dashboard.hoursSessionsDesc}
          data={data.hoursTrend}
          xKey="month"
          series={[
            { key: "hours", label: d.money.dashboard.seriesHours },
            { key: "sessions", label: d.money.dashboard.seriesSessions },
          ]}
          valueFormat="number"
          xFormat="month"
        />
        <GroupedBarCard
          title={d.money.dashboard.modelComparisonTitle}
          description={d.money.dashboard.modelComparisonDesc}
          data={data.modelComparison.data}
          xKey="name"
          series={data.modelComparison.series}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title={d.money.dashboard.projectedVsActualTitle}
          description={d.money.dashboard.projectedVsActualDesc}
          data={data.projectedVsActual}
          xKey="month"
          series={[
            { key: "actual", label: d.money.dashboard.seriesActual },
            { key: "predicted", label: d.money.dashboard.seriesProjected, dash: "6 4" },
          ]}
          valueFormat={{ money: data.currency }}
          xFormat="month"
          connectNulls
        />
        <DonutChartCard
          title={d.money.dashboard.complianceTitle}
          description={d.money.dashboard.complianceDesc}
          data={compliance.slices}
          colorByName={compliance.colors}
          valueFormat="number"
          centerValue={fmtNumber(fm, compliance.total)}
          centerLabel={d.money.dashboard.complianceCenterLabel(compliance.total)}
        />
        <LibraryCardView ctx={ctx} library={data.library} />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title={d.money.dashboard.forecastBreakdownTitle}
        description={d.money.dashboard.forecastBreakdownDesc}
        data={data.forecastBreakdown.data}
        xKey="month"
        series={data.forecastBreakdown.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <StackedBarCard
        className="lg:col-span-2"
        title={d.money.dashboard.payoutHistoryTitle}
        description={d.money.dashboard.payoutHistoryDesc}
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      {governance ? (
        <Grid>
          <PieChartCard
            title={d.money.dashboard.splitTitle}
            description={d.money.dashboard.splitDesc}
            data={data.split}
            valueFormat={{ money: data.currency }}
          />
          <GroupedBarCard
            title={d.money.dashboard.accuracyTitle}
            description={d.money.dashboard.accuracyDesc}
            data={data.accuracy}
            xKey="month"
            series={[{ key: "error", label: d.money.dashboard.accuracyError }]}
            valueFormat="percent"
            xFormat="month"
          />
        </Grid>
      ) : null}

      {governance ? (
        <HorizontalBarCard
          title={d.money.dashboard.balancesTitle}
          data={data.balances}
          valueFormat={{ money: data.currency }}
          highlightNegative
          emptyMessage={d.money.dashboard.balancesEmpty}
        />
      ) : null}

      <Card>
        <CardHeader title={d.money.dashboard.recentPayouts} />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee />
        </CardBody>
      </Card>

      {governance ? <AiInsightPanel report={data.aiReport} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------- Finance */

function FinanceDashboard({
  ctx,
  data,
}: {
  ctx: Ctx;
  data: Awaited<ReturnType<typeof loadFinanceDashboard>>;
}) {
  const { d, fm } = ctx;
  const fmtMoney = moneyFmt(fm, data.currency);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile
          label={d.money.dashboard.grossRevenue}
          value={fmtMoney(data.kpis.periodGross)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.netRevenue}
          value={fmtMoney(data.kpis.periodNet)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.pendingPayouts}
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={d.money.dashboard.awaiting(data.kpis.pendingCount)}
        />
        <StatTile
          label={d.money.dashboard.outstandingBalances}
          value={fmtMoney(data.kpis.outstanding)}
          hint={d.money.dashboard.owedToPayees}
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title={d.money.dashboard.earningsTrendTitle}
        description={d.money.dashboard.earningsTrendDesc}
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: d.money.dashboard.seriesNet },
          { key: "gross", label: d.money.dashboard.seriesGross },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title={d.money.dashboard.splitTitle}
          description={d.money.dashboard.splitDesc}
          data={data.split}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title={d.money.dashboard.projectedVsActualTitle}
          description={d.money.dashboard.projectedVsActualDesc}
          data={data.projectedVsActual}
          xKey="month"
          series={[
            { key: "actual", label: d.money.dashboard.seriesActual },
            { key: "predicted", label: d.money.dashboard.seriesProjected, dash: "6 4" },
          ]}
          valueFormat={{ money: data.currency }}
          xFormat="month"
          connectNulls
        />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title={d.money.dashboard.forecastBreakdownTitle}
        description={d.money.dashboard.forecastBreakdownDesc}
        data={data.forecastBreakdown.data}
        xKey="month"
        series={data.forecastBreakdown.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <GroupedBarCard
          title={d.money.dashboard.accuracyTitle}
          description={d.money.dashboard.accuracyDesc}
          data={data.accuracy}
          xKey="month"
          series={[{ key: "error", label: d.money.dashboard.accuracyError }]}
          valueFormat="percent"
          xFormat="month"
        />
        <HorizontalBarCard
          title={d.money.dashboard.balancesTitle}
          data={data.balances}
          valueFormat={{ money: data.currency }}
          highlightNegative
          emptyMessage={d.money.dashboard.balancesEmpty}
        />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title={d.money.dashboard.payoutHistoryTitle}
        description={d.money.dashboard.payoutHistoryDesc}
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Card>
        <CardHeader title={d.money.dashboard.recentPayouts} />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee />
        </CardBody>
      </Card>

      <AiInsightPanel report={data.aiReport} />
    </div>
  );
}

/* --------------------------------------------------------------- Model */

function ModelDashboard({
  ctx,
  data,
}: {
  ctx: Ctx;
  data: Awaited<ReturnType<typeof loadModelDashboard>>;
}) {
  const { d, fm } = ctx;
  const fmtMoney = moneyFmt(fm, data.currency);
  const compliance = complianceView(ctx, data.compliance);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile
          label={d.money.dashboard.grossEarnings}
          value={fmtMoney(data.kpis.periodGross)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.netEarnings}
          value={fmtMoney(data.kpis.periodNet)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.hoursWorked}
          value={fmtHoursTile(ctx, data.kpis.periodHours)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.pendingPayout}
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={d.money.dashboard.awaiting(data.kpis.pendingCount)}
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title={d.money.dashboard.earningsTrendTitle}
        description={d.money.dashboard.earningsTrendDescOwn}
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: d.money.dashboard.seriesNet },
          { key: "gross", label: d.money.dashboard.seriesGross },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title={d.money.dashboard.platformShareTitle}
          description={d.money.dashboard.platformShareDesc}
          data={data.shareByPlatform}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title={d.money.dashboard.hoursSessionsTitle}
          description={d.money.dashboard.hoursSessionsDescOwn}
          data={data.hoursTrend}
          xKey="month"
          series={[
            { key: "hours", label: d.money.dashboard.seriesHours },
            { key: "sessions", label: d.money.dashboard.seriesSessions },
          ]}
          valueFormat="number"
          xFormat="month"
        />
        <DonutChartCard
          title={d.money.dashboard.complianceTitle}
          description={d.money.dashboard.complianceDescOwn}
          data={compliance.slices}
          colorByName={compliance.colors}
          valueFormat="number"
          centerValue={fmtNumber(fm, compliance.total)}
          centerLabel={d.money.dashboard.complianceCenterLabel(compliance.total)}
        />
        <StackedBarCard
          title={d.money.dashboard.payoutHistoryTitle}
          description={d.money.dashboard.payoutHistoryDescOwn}
          data={data.payouts.data}
          xKey="month"
          series={data.payouts.series}
          valueFormat={{ money: data.currency }}
          xFormat="month"
        />
      </Grid>

      <Card>
        <CardHeader title={d.money.dashboard.recentPayouts} />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee={false} />
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- Operator */

function OperatorDashboard({
  ctx,
  data,
}: {
  ctx: Ctx;
  data: Awaited<ReturnType<typeof loadOperatorDashboard>>;
}) {
  const { d, fm } = ctx;
  const fmtMoney = moneyFmt(fm, data.currency);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow columns={3}>
        <StatTile
          label={d.money.dashboard.currentBalance}
          value={fmtMoney(data.kpis.balance)}
          hint={d.money.dashboard.owedToYou}
        />
        <StatTile
          label={d.money.dashboard.ledgerShare}
          value={fmtMoney(data.kpis.periodShare)}
          hint={d.money.dashboard.monthToDate}
        />
        <StatTile
          label={d.money.dashboard.pendingPayout}
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={d.money.dashboard.awaiting(data.kpis.pendingCount)}
        />
      </StatTileRow>

      <LineChartCard
        title={d.money.dashboard.shareTrendTitle}
        description={d.money.dashboard.shareTrendDesc}
        data={data.shareTrend}
        xKey="month"
        series={[{ key: "share", label: d.money.dashboard.shareTrendSeries }]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <StackedBarCard
        title={d.money.dashboard.payoutHistoryTitle}
        description={d.money.dashboard.payoutHistoryDescOwn}
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Card>
        <CardHeader title={d.money.dashboard.recentPayouts} />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee={false} />
        </CardBody>
      </Card>
    </div>
  );
}
