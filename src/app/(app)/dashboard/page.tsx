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

const fmtMonth = (value: string | number) => month(String(value));
const fmtNumber = (value: number) => number(value, { decimals: Number.isInteger(value) ? 0 : 1 });
const fmtPercent = (value: number) => percent(value);
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <Grid>
        <PieChartCard
          title="Earnings share by model"
          description="Net revenue mix across models (last 12 months)."
          data={data.shareByModel}
          valueFormatter={fmtMoney}
        />
        <PieChartCard
          title="Earnings share by platform"
          description="Net revenue mix across platforms (last 12 months)."
          data={data.shareByPlatform}
          valueFormatter={fmtMoney}
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
          valueFormatter={fmtNumber}
          xFormatter={fmtMonth}
        />
        <GroupedBarCard
          title="Model comparison"
          description="Net revenue by model, this month vs last."
          data={data.modelComparison.data}
          xKey="name"
          series={data.modelComparison.series}
          valueFormatter={fmtMoney}
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
          valueFormatter={fmtMoney}
          xFormatter={fmtMonth}
          connectNulls
        />
        <DonutChartCard
          title="Document compliance"
          description="Studio-wide document status."
          data={compliance.slices}
          colorByName={COMPLIANCE_COLORS}
          valueFormatter={fmtNumber}
          centerValue={fmtNumber(compliance.total)}
          centerLabel="documents"
        />
      </Grid>

      <StackedBarCard
        className="lg:col-span-2"
        title="Forecast breakdown by model"
        description="Predicted net revenue for the coming months, stacked by model."
        data={data.forecastBreakdown.data}
        xKey="month"
        series={data.forecastBreakdown.series}
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <StackedBarCard
        className="lg:col-span-2"
        title="Payout history"
        description="Payout totals by month, stacked by status."
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      {governance ? (
        <Grid>
          <PieChartCard
            title="Split distribution"
            description="Net revenue split across studio, model and operator pools."
            data={data.split}
            valueFormatter={fmtMoney}
          />
          <GroupedBarCard
            title="Forecast accuracy"
            description="Studio-wide forecast error, trailing 3 months."
            data={data.accuracy}
            xKey="month"
            series={[{ key: "error", label: "Error %" }]}
            valueFormatter={fmtPercent}
            xFormatter={fmtMonth}
          />
        </Grid>
      ) : null}

      {governance ? (
        <HorizontalBarCard
          title="Payee outstanding balances"
          data={data.balances}
          valueFormatter={fmtMoney}
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <Grid>
        <PieChartCard
          title="Split distribution"
          description="Net revenue split across studio, model and operator pools."
          data={data.split}
          valueFormatter={fmtMoney}
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
          valueFormatter={fmtMoney}
          xFormatter={fmtMonth}
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <Grid>
        <GroupedBarCard
          title="Forecast accuracy"
          description="Studio-wide forecast error, trailing 3 months."
          data={data.accuracy}
          xKey="month"
          series={[{ key: "error", label: "Error %" }]}
          valueFormatter={fmtPercent}
          xFormatter={fmtMonth}
        />
        <HorizontalBarCard
          title="Payee outstanding balances"
          data={data.balances}
          valueFormatter={fmtMoney}
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <Grid>
        <PieChartCard
          title="Platform share"
          description="Your net earnings mix across platforms."
          data={data.shareByPlatform}
          valueFormatter={fmtMoney}
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
          valueFormatter={fmtNumber}
          xFormatter={fmtMonth}
        />
        <DonutChartCard
          title="Document compliance"
          description="Your document status."
          data={compliance.slices}
          colorByName={COMPLIANCE_COLORS}
          valueFormatter={fmtNumber}
          centerValue={fmtNumber(compliance.total)}
          centerLabel="documents"
        />
        <StackedBarCard
          title="Payout history"
          description="Your payout totals by month, stacked by status."
          data={data.payouts.data}
          xKey="month"
          series={data.payouts.series}
          valueFormatter={fmtMoney}
          xFormatter={fmtMonth}
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
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
      />

      <StackedBarCard
        title="Payout history"
        description="Your payout totals by month, stacked by status."
        data={data.payouts.data}
        xKey="month"
        series={data.payouts.series}
        valueFormatter={fmtMoney}
        xFormatter={fmtMonth}
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
