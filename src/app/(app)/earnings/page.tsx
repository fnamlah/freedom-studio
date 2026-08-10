import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { money } from "@/lib/format";

import { EarningForm, type AccountOption, type ModelOption } from "./earning-form";
import { EarningsTable, type EarningRow } from "./earnings-table";
import { ModelFilter } from "./model-filter";

export const metadata: Metadata = { title: "Earnings" };

type EarningQueryRow = {
  id: string;
  model_id: string;
  platform_account_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  platform_fee_amount: number;
  net_amount: number;
  currency: string;
};

/**
 * Earnings — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * `earnings` is the MONEY source of truth (docs/04 §4.7): one row per platform
 * statement period per account, unique on (account, period_start, period_end).
 * `net_amount` — what the studio received — is the split input for accounting
 * (docs/09). All reads go through the caller's own RLS-scoped client (SA/MGR hold
 * full CRUD); mutations re-guard in `./actions.ts` and surface the unique-violation
 * as a friendly message.
 *
 * The `?model=` filter narrows the query server-side, so the KPI tiles reflect
 * exactly what the table shows.
 */
export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { supabase } = await requireRole("super_admin", "manager");
  const { model } = await searchParams;

  const [modelsResult, accountsResult, platformsResult] = await Promise.all([
    supabase.from("models").select("id, stage_name").order("stage_name", { ascending: true }),
    supabase
      .from("platform_accounts")
      .select("id, model_id, username, platform_id, platform_fee_percent, status")
      .order("created_at", { ascending: true }),
    supabase.from("platforms").select("id, name"),
  ]);

  const models = modelsResult.data ?? [];
  const accountsRaw = accountsResult.data ?? [];
  const platforms = platformsResult.data ?? [];

  const modelIds = new Set(models.map((m) => m.id));
  const activeModelFilter = model && modelIds.has(model) ? model : "all";

  let earningsQuery = supabase
    .from("earnings")
    .select(
      "id, model_id, platform_account_id, period_start, period_end, gross_amount, platform_fee_amount, net_amount, currency",
    )
    .order("period_end", { ascending: false });

  if (activeModelFilter !== "all") {
    earningsQuery = earningsQuery.eq("model_id", activeModelFilter);
  }

  const { data: earningsData } = await earningsQuery;
  const earnings = (earningsData ?? []) as EarningQueryRow[];

  /* ------------------------------------------------------------- lookups --- */

  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const modelName = new Map(models.map((m) => [m.id, m.stage_name]));

  const buildLabel = (platformId: string, username: string, status: string) =>
    `${platformName.get(platformId) ?? "Platform"} · ${username}${
      status === "active" ? "" : ` (${status})`
    }`;

  const accountLabel = new Map(
    accountsRaw.map((a) => [a.id, buildLabel(a.platform_id, a.username, a.status)]),
  );

  const modelOptions: ModelOption[] = models.map((m) => ({
    id: m.id,
    stage_name: m.stage_name,
  }));

  const accountOptions: AccountOption[] = accountsRaw.map((a) => ({
    id: a.id,
    model_id: a.model_id,
    label: buildLabel(a.platform_id, a.username, a.status),
    platform_fee_percent: a.platform_fee_percent,
    status: a.status,
  }));

  const rows: EarningRow[] = earnings.map((e) => ({
    id: e.id,
    model_id: e.model_id,
    platform_account_id: e.platform_account_id,
    model_name: modelName.get(e.model_id) ?? "Unknown model",
    account_label: accountLabel.get(e.platform_account_id) ?? "Unknown account",
    period_start: e.period_start,
    period_end: e.period_end,
    gross_amount: e.gross_amount,
    platform_fee_amount: e.platform_fee_amount,
    net_amount: e.net_amount,
    currency: e.currency,
  }));

  /* --------------------------------------------------------------- stats --- */

  const grossTotal = earnings.reduce((sum, e) => sum + Number(e.gross_amount ?? 0), 0);
  const feeTotal = earnings.reduce((sum, e) => sum + Number(e.platform_fee_amount ?? 0), 0);
  const netTotal = earnings.reduce((sum, e) => sum + Number(e.net_amount ?? 0), 0);

  const scopeHint = activeModelFilter === "all" ? "All models" : "Filtered model";

  return (
    <>
      <PageHeader
        title="Earnings"
        description="Money tracking — the source of truth. Record one statement per platform account per period; net is the input to the commission split."
        breadcrumbs={[{ label: "Earnings" }]}
        actions={
          <EarningForm mode="create" models={modelOptions} accounts={accountOptions} />
        }
      />

      {models.length === 0 ? (
        <EmptyState
          title="No models yet"
          description="Earnings statements are recorded against a model's platform account. Add a model and a platform account first, then come back to record statements."
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile label="Statements" value={earnings.length} hint={scopeHint} />
            <StatTile label="Gross" value={money(grossTotal)} hint="Billed by platforms" />
            <StatTile label="Platform fees" value={money(feeTotal)} hint="Platforms' cut" />
            <StatTile label="Net received" value={money(netTotal)} hint="Split input (docs/09)" />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{rows.length} shown</span>
          </div>

          <EarningsTable rows={rows} models={modelOptions} accounts={accountOptions} />
        </>
      )}
    </>
  );
}
