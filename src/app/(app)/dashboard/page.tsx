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
import { requireUser, ROLE_LABELS } from "@/lib/auth/guard";
import { money, month, number, percent } from "@/lib/format";

import {
  loadFinanceDashboard,
  loadModelDashboard,
  loadOperatorDashboard,
  loadStudioDashboard,
} from "./data";

export const metadata: Metadata = { title: "Dashboard" };

/* ------------------------------------------------------------- formatters */

const fmtNumber = (value: number) => number(value, { decimals: Number.isInteger(value) ? 0 : 1 });
const fmtHoursTile = (value: number) => `${number(value, { decimals: 1 })}h`;

function moneyFmt(currency: string) {
  return (value: number) => money(value, currency);
}

const COMPLIANCE_COLORS = {
  Valid: STATUS_COLORS.success,
  Expiring: STATUS_COLORS.warning,
  Expired: STATUS_COLORS.danger,
} as const;

function complianceData(counts: {
  valid_count: number;
  expiring_count: number;
  expired_count: number;
}) {
  return {
    slices: [
      { name: "Valid", value: counts.valid_count },
      { name: "Expiring", value: counts.expiring_count },
      { name: "Expired", value: counts.expired_count },
    ],
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
  library,
}: {
  library: Awaited<ReturnType<typeof loadStudioDashboard>>["library"];
}) {
  return (
    <Card>
      <CardHeader
        title="Library knowledge base"
        description="Files ingested and AI-analyzed for the assistant."
      />
      <CardBody>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Files</dt>
            <dd className="text-xl font-semibold text-foreground">{fmtNumber(library.total)}</dd>
          </div>
          <div>
            <dt className="text-muted">AI-analyzed</dt>
            <dd className="text-xl font-semibold text-foreground">{fmtNumber(library.analyzed)}</dd>
          </div>
          <div>
            <dt className="text-muted">Awaiting review</dt>
            <dd className="text-xl font-semibold text-foreground">
              {fmtNumber(library.awaitingReview)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Not machine-readable</dt>
            <dd className="text-xl font-semibold text-foreground">{fmtNumber(library.unreadable)}</dd>
          </div>
        </dl>
        {library.topCategories.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            {library.topCategories.map((c) => (
              <li key={c.name} className="flex justify-between">
                <span className="text-muted">{c.name}</span>
                <span className="font-medium text-foreground">{fmtNumber(c.count)}</span>
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

  const header = (
    <PageHeader
      title={`Welcome back, ${profile.full_name.split(" ")[0]}`}
      description={`Signed in as ${ROLE_LABELS[role]}. Your dashboard shows only what your role permits.`}
    />
  );

  if (role === "super_admin" || role === "manager") {
    const governance = role === "super_admin";
    const data = await loadStudioDashboard(supabase, { governance });
    return (
      <>
        {header}
        <StudioDashboard data={data} governance={governance} />
      </>
    );
  }

  if (role === "finance") {
    const data = await loadFinanceDashboard(supabase);
    return (
      <>
        {header}
        <FinanceDashboard data={data} />
      </>
    );
  }

  if (role === "model") {
    const data = await loadModelDashboard(supabase);
    return (
      <>
        {header}
        <ModelDashboard data={data} />
      </>
    );
  }

  const data = await loadOperatorDashboard(supabase);
  return (
    <>
      {header}
      <OperatorDashboard data={data} />
    </>
  );
}

/* --------------------------------------------------------- Studio (SA/MGR) */

function StudioDashboard({
  data,
  governance,
}: {
  data: Awaited<ReturnType<typeof loadStudioDashboard>>;
  governance: boolean;
}) {
  const fmtMoney = moneyFmt(data.currency);
  const compliance = complianceData(data.compliance);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile label="Gross revenue" value={fmtMoney(data.kpis.periodGross)} hint="Month to date" />
        <StatTile label="Net revenue" value={fmtMoney(data.kpis.periodNet)} hint="Month to date" />
        <StatTile label="Hours worked" value={fmtHoursTile(data.kpis.periodHours)} hint="Month to date" />
        <StatTile
          label="Pending payouts"
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={`${data.kpis.pendingCount} awaiting`}
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title="Earnings trend"
        description="Net and gross by month (last 12 months)."
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: "Net" },
          { key: "gross", label: "Gross" },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title="Earnings share by model"
          description="Net revenue mix across models (last 12 months)."
          data={data.shareByModel}
          valueFormat={{ money: data.currency }}
        />
        <PieChartCard
          title="Earnings share by platform"
          description="Net revenue mix across platforms (last 12 months)."
          data={data.shareByPlatform}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title="Hours & sessions"
          description="Hours worked and session count by month."
          data={data.hoursTrend}
          xKey="month"
          series={[
            { key: "hours", label: "Hours" },
            { key: "sessions", label: "Sessions" },
          ]}
          valueFormat="number"
          xFormat="month"
        />
        <GroupedBarCard
          title="Model comparison"
          description="Net revenue by model, this month vs last."
          data={data.modelComparison.data}
          xKey="name"
          series={data.modelComparison.series}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title="Projected vs actual net"
          description="Realised net (solid) against the live forecast (dashed)."
          data={data.projectedVsActual}
          xKey="month"
          series={[
            { key: "actual", label: "Actual" },
            { key: "predicted", label: "Projected", dash: "6 4" },
          ]}
          valueFormat={{ money: data.currency }}
          xFormat="month"
          connectNulls
        />
        <DonutChartCard
          title="Document compliance"
          description="Studio-wide document status."
          data={compliance.slices}
          colorByName={COMPLIANCE_COLORS}
          valueFormat="number"
          centerValue={fmtNumber(compliance.total)}
          centerLabel="documents"
        />
        <LibraryCardView library={data.library} />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title="Forecast breakdown by model"
        description="Predicted net revenue for the coming months, stacked by model."
        data={data.forecastBreakdown.data}
        xKey="month"
        series={data.forecastBreakdown.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <StackedBarCard
        className="lg:col-span-2"
        title="Payout history"
        description="Payout totals by month, stacked by status."
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      {governance ? (
        <Grid>
          <PieChartCard
            title="Split distribution"
            description="Net revenue split across studio, model and operator pools."
            data={data.split}
            valueFormat={{ money: data.currency }}
          />
          <GroupedBarCard
            title="Forecast accuracy"
            description="Studio-wide forecast error, trailing 3 months."
            data={data.accuracy}
            xKey="month"
            series={[{ key: "error", label: "Error %" }]}
            valueFormat="percent"
            xFormat="month"
          />
        </Grid>
      ) : null}

      {governance ? (
        <HorizontalBarCard
          title="Payee outstanding balances"
          data={data.balances}
          valueFormat={{ money: data.currency }}
          highlightNegative
          emptyMessage="No outstanding balances"
        />
      ) : null}

      <Card>
        <CardHeader title="Recent payouts" />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee />
        </CardBody>
      </Card>

      {governance ? <AiInsightPanel report={data.aiReport} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------- Finance */

function FinanceDashboard({ data }: { data: Awaited<ReturnType<typeof loadFinanceDashboard>> }) {
  const fmtMoney = moneyFmt(data.currency);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile label="Gross revenue" value={fmtMoney(data.kpis.periodGross)} hint="Month to date" />
        <StatTile label="Net revenue" value={fmtMoney(data.kpis.periodNet)} hint="Month to date" />
        <StatTile
          label="Pending payouts"
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={`${data.kpis.pendingCount} awaiting`}
        />
        <StatTile
          label="Outstanding balances"
          value={fmtMoney(data.kpis.outstanding)}
          hint="Owed to payees"
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title="Earnings trend"
        description="Net and gross by month (last 12 months)."
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: "Net" },
          { key: "gross", label: "Gross" },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title="Split distribution"
          description="Net revenue split across studio, model and operator pools."
          data={data.split}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title="Projected vs actual net"
          description="Realised net (solid) against the live forecast (dashed)."
          data={data.projectedVsActual}
          xKey="month"
          series={[
            { key: "actual", label: "Actual" },
            { key: "predicted", label: "Projected", dash: "6 4" },
          ]}
          valueFormat={{ money: data.currency }}
          xFormat="month"
          connectNulls
        />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title="Forecast breakdown by model"
        description="Predicted net revenue for the coming months, stacked by model."
        data={data.forecastBreakdown.data}
        xKey="month"
        series={data.forecastBreakdown.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <GroupedBarCard
          title="Forecast accuracy"
          description="Studio-wide forecast error, trailing 3 months."
          data={data.accuracy}
          xKey="month"
          series={[{ key: "error", label: "Error %" }]}
          valueFormat="percent"
          xFormat="month"
        />
        <HorizontalBarCard
          title="Payee outstanding balances"
          data={data.balances}
          valueFormat={{ money: data.currency }}
          highlightNegative
          emptyMessage="No outstanding balances"
        />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title="Payout history"
        description="Payout totals by month, stacked by status."
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Card>
        <CardHeader title="Recent payouts" />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee />
        </CardBody>
      </Card>

      <AiInsightPanel report={data.aiReport} />
    </div>
  );
}

/* --------------------------------------------------------------- Model */

function ModelDashboard({ data }: { data: Awaited<ReturnType<typeof loadModelDashboard>> }) {
  const fmtMoney = moneyFmt(data.currency);
  const compliance = complianceData(data.compliance);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow>
        <StatTile label="Gross earnings" value={fmtMoney(data.kpis.periodGross)} hint="Month to date" />
        <StatTile label="Net earnings" value={fmtMoney(data.kpis.periodNet)} hint="Month to date" />
        <StatTile label="Hours worked" value={fmtHoursTile(data.kpis.periodHours)} hint="Month to date" />
        <StatTile
          label="Pending payout"
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={`${data.kpis.pendingCount} awaiting`}
        />
      </StatTileRow>

      <LineChartCard
        className="lg:col-span-2"
        title="Earnings trend"
        description="Your net and gross earnings by month."
        data={data.earningsTrend}
        xKey="month"
        series={[
          { key: "net", label: "Net" },
          { key: "gross", label: "Gross" },
        ]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Grid>
        <PieChartCard
          title="Platform share"
          description="Your net earnings mix across platforms."
          data={data.shareByPlatform}
          valueFormat={{ money: data.currency }}
        />
        <LineChartCard
          title="Hours & sessions"
          description="Your hours worked and session count by month."
          data={data.hoursTrend}
          xKey="month"
          series={[
            { key: "hours", label: "Hours" },
            { key: "sessions", label: "Sessions" },
          ]}
          valueFormat="number"
          xFormat="month"
        />
        <DonutChartCard
          title="Document compliance"
          description="Your document status."
          data={compliance.slices}
          colorByName={COMPLIANCE_COLORS}
          valueFormat="number"
          centerValue={fmtNumber(compliance.total)}
          centerLabel="documents"
        />
        <StackedBarCard
          title="Payout history"
          description="Your payout totals by month, stacked by status."
          data={data.payouts.data}
          xKey="month"
          series={data.payouts.series}
          valueFormat={{ money: data.currency }}
          xFormat="month"
        />
      </Grid>

      <Card>
        <CardHeader title="Recent payouts" />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee={false} />
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- Operator */

function OperatorDashboard({ data }: { data: Awaited<ReturnType<typeof loadOperatorDashboard>> }) {
  const fmtMoney = moneyFmt(data.currency);

  return (
    <div className="flex flex-col gap-6">
      <StatTileRow columns={3}>
        <StatTile label="Current balance" value={fmtMoney(data.kpis.balance)} hint="Owed to you" />
        <StatTile label="Ledger share" value={fmtMoney(data.kpis.periodShare)} hint="Month to date" />
        <StatTile
          label="Pending payout"
          value={fmtMoney(data.kpis.pendingTotal)}
          hint={`${data.kpis.pendingCount} awaiting`}
        />
      </StatTileRow>

      <LineChartCard
        title="Ledger share trend"
        description="Your revenue-share credits by month, from the ledger."
        data={data.shareTrend}
        xKey="month"
        series={[{ key: "share", label: "Share credited" }]}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <StackedBarCard
        title="Payout history"
        description="Your payout totals by month, stacked by status."
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormat={{ money: data.currency }}
        xFormat="month"
      />

      <Card>
        <CardHeader title="Recent payouts" />
        <CardBody flush>
          <PayoutTable rows={data.payoutRows} showPayee={false} />
        </CardBody>
      </Card>
    </div>
  );
}
