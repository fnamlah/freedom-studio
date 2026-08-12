import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import type { Database } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { ModelFilter } from "./model-filter";
import { SessionForm, type AccountOption, type ModelOption } from "./session-form";
import { SessionsTable, type SessionRow } from "./sessions-table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).studio.sessions.metaTitle };
}

type AccountStatus = Database["public"]["Enums"]["account_status"];

type SessionQueryRow = {
  id: string;
  model_id: string;
  platform_account_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  gross_earnings: number;
  currency: string;
  notes: string | null;
};

/**
 * Work sessions — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * `work_sessions` is the HOURS source of truth (docs/04 §4.6): this page tracks
 * time worked. Per-session gross is recorded when known but is secondary — money
 * lives in Earnings. All reads go through the caller's own RLS-scoped client
 * (SA/MGR hold full CRUD); mutations re-guard in `./actions.ts`.
 *
 * The `?model=` filter narrows the query server-side, so the KPI tiles reflect
 * exactly what the table shows.
 */
export default async function SessionsPage({
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

  let sessionsQuery = supabase
    .from("work_sessions")
    .select(
      "id, model_id, platform_account_id, started_at, ended_at, duration_minutes, gross_earnings, currency, notes",
    )
    .order("started_at", { ascending: false });

  if (activeModelFilter !== "all") {
    sessionsQuery = sessionsQuery.eq("model_id", activeModelFilter);
  }

  const { data: sessionsData } = await sessionsQuery;
  const sessions = (sessionsData ?? []) as SessionQueryRow[];

  /* ------------------------------------------------------------- lookups --- */

  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const modelName = new Map(models.map((m) => [m.id, m.stage_name]));

  /**
   * `Platform · handle (suspended)`. The status suffix is a translated label, not
   * the raw enum value — the account picker is the one place a non-active status
   * is surfaced as prose.
   */
  const buildLabel = (platformId: string, username: string, status: AccountStatus) =>
    `${platformName.get(platformId) ?? d.studio.sessions.platformFallback} · ${username}${
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

  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    model_id: s.model_id,
    platform_account_id: s.platform_account_id,
    model_name: modelName.get(s.model_id) ?? d.studio.sessions.unknownModel,
    account_label:
      accountLabel.get(s.platform_account_id) ?? d.studio.sessions.unknownAccount,
    started_at: s.started_at,
    ended_at: s.ended_at,
    duration_minutes: s.duration_minutes,
    gross_earnings: s.gross_earnings,
    currency: s.currency,
    notes: s.notes,
  }));

  /* --------------------------------------------------------------- stats --- */

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const openCount = sessions.filter((s) => s.ended_at === null).length;
  const grossTotal = sessions.reduce((sum, s) => sum + Number(s.gross_earnings ?? 0), 0);

  const scopeHint =
    activeModelFilter === "all"
      ? d.studio.sessions.scopeAll
      : d.studio.sessions.scopeFiltered;

  return (
    <>
      <PageHeader
        title={d.studio.sessions.title}
        description={d.studio.sessions.description}
        breadcrumbs={[{ label: d.studio.sessions.title }]}
        actions={
          <SessionForm mode="create" models={modelOptions} accounts={accountOptions} />
        }
      />

      {models.length === 0 ? (
        <EmptyState
          title={d.studio.sessions.noModelsTitle}
          description={d.studio.sessions.noModelsDescription}
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile
              label={d.studio.sessions.statSessions}
              value={sessions.length}
              hint={scopeHint}
            />
            <StatTile
              label={d.studio.sessions.statHours}
              value={fm.hours(totalMinutes)}
              hint={d.studio.sessions.statHoursHint}
            />
            <StatTile
              label={d.studio.sessions.statOpen}
              value={openCount}
              hint={d.studio.sessions.statOpenHint}
            />
            <StatTile
              label={d.studio.sessions.statGross}
              value={fm.money(grossTotal)}
              hint={d.studio.sessions.statGrossHint}
            />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{d.studio.sessions.shown(rows.length)}</span>
          </div>

          <SessionsTable rows={rows} models={modelOptions} accounts={accountOptions} />
        </>
      )}
    </>
  );
}
