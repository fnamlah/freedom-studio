import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { hours, money } from "@/lib/format";

import { ModelFilter } from "./model-filter";
import { SessionForm, type AccountOption, type ModelOption } from "./session-form";
import { SessionsTable, type SessionRow } from "./sessions-table";

export const metadata: Metadata = { title: "Sessions" };

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

  const accountLabel = new Map(
    accountsRaw.map((a) => [
      a.id,
      `${platformName.get(a.platform_id) ?? "Platform"} · ${a.username}${
        a.status === "active" ? "" : ` (${a.status})`
      }`,
    ]),
  );

  const modelOptions: ModelOption[] = models.map((m) => ({
    id: m.id,
    stage_name: m.stage_name,
  }));

  const accountOptions: AccountOption[] = accountsRaw.map((a) => ({
    id: a.id,
    model_id: a.model_id,
    label: `${platformName.get(a.platform_id) ?? "Platform"} · ${a.username}${
      a.status === "active" ? "" : ` (${a.status})`
    }`,
    platform_fee_percent: a.platform_fee_percent,
    status: a.status,
  }));

  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    model_id: s.model_id,
    platform_account_id: s.platform_account_id,
    model_name: modelName.get(s.model_id) ?? "Unknown model",
    account_label: accountLabel.get(s.platform_account_id) ?? "Unknown account",
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

  const scopeHint = activeModelFilter === "all" ? "All models" : "Filtered model";

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Time tracking — the hours source of truth. Log when a model worked an account; the database computes each session's duration."
        breadcrumbs={[{ label: "Sessions" }]}
        actions={
          <SessionForm mode="create" models={modelOptions} accounts={accountOptions} />
        }
      />

      {models.length === 0 ? (
        <EmptyState
          title="No models yet"
          description="Sessions are logged against a model's platform account. Add a model and a platform account first, then come back to track hours."
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile label="Sessions" value={sessions.length} hint={scopeHint} />
            <StatTile label="Hours logged" value={hours(totalMinutes)} hint="Sum of durations" />
            <StatTile label="Open sessions" value={openCount} hint="No end time yet" />
            <StatTile
              label="Gross logged"
              value={money(grossTotal)}
              hint="Per-session; Earnings is money truth"
            />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{rows.length} shown</span>
          </div>

          <SessionsTable rows={rows} models={modelOptions} accounts={accountOptions} />
        </>
      )}
    </>
  );
}
