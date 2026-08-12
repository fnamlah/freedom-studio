import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import type { Database } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { EarningForm, type AccountOption, type ModelOption } from "./earning-form";
import { EarningsTable, type EarningRow } from "./earnings-table";
import { ModelFilter } from "./model-filter";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).studio.earnings.metaTitle };
}

type AccountStatus = Database["public"]["Enums"]["account_status"];

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
  const d = await getDict();
  const fm = fmt(await getLocale());

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

  /** The status suffix is a translated label, never the raw enum value. */
  const buildLabel = (platformId: string, username: string, status: AccountStatus) =>
    `${platformName.get(platformId) ?? d.studio.earnings.platformFallback} · ${username}${
      status === "active" ? "" : ` (${d.studio.accountStatus[status]})`
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
    model_name: modelName.get(e.model_id) ?? d.studio.earnings.unknownModel,
    account_label:
      accountLabel.get(e.platform_account_id) ?? d.studio.earnings.unknownAccount,
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

  const scopeHint =
    activeModelFilter === "all"
      ? d.studio.earnings.scopeAll
      : d.studio.earnings.scopeFiltered;

  return (
    <>
      <PageHeader
        title={d.studio.earnings.title}
        description={d.studio.earnings.description}
        breadcrumbs={[{ label: d.studio.earnings.title }]}
        actions={
          <EarningForm mode="create" models={modelOptions} accounts={accountOptions} />
        }
      />

      {models.length === 0 ? (
        <EmptyState
          title={d.studio.earnings.noModelsTitle}
          description={d.studio.earnings.noModelsDescription}
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile
              label={d.studio.earnings.statStatements}
              value={earnings.length}
              hint={scopeHint}
            />
            <StatTile
              label={d.studio.earnings.statGross}
              value={fm.money(grossTotal)}
              hint={d.studio.earnings.statGrossHint}
            />
            <StatTile
              label={d.studio.earnings.statFees}
              value={fm.money(feeTotal)}
              hint={d.studio.earnings.statFeesHint}
            />
            <StatTile
              label={d.studio.earnings.statNet}
              value={fm.money(netTotal)}
              hint={d.studio.earnings.statNetHint}
            />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{d.studio.earnings.shown(rows.length)}</span>
          </div>

          <EarningsTable rows={rows} models={modelOptions} accounts={accountOptions} />
        </>
      )}
    </>
  );
}
