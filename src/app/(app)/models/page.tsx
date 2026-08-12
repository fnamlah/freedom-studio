import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { getDict } from "@/lib/i18n/server";

import { ModelForm } from "./model-form";
import { ModelsTable, type ModelListRow } from "./models-table";
import { StatusFilter } from "./status-filter";
import { MODEL_STATUSES, type ModelStatus } from "./status";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).studio.models.metaTitle };
}

function normalizeStatus(value: string | undefined): ModelStatus | "all" {
  return value && (MODEL_STATUSES as readonly string[]).includes(value)
    ? (value as ModelStatus)
    : "all";
}

/**
 * Models roster — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * Read through the caller's own RLS-scoped client; SA/MGR see every model row
 * including the sensitive `legal_name` column, and they are the only readers of
 * it. The full list is fetched once so the KPI tiles always reflect the whole
 * roster; the `?status=` filter only narrows what the table renders.
 */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase } = await requireRole("super_admin", "manager");
  const { status } = await searchParams;
  const activeFilter = normalizeStatus(status);
  const d = await getDict();

  const { data } = await supabase
    .from("models")
    .select("id, stage_name, legal_name, status, country, start_date, commission_percent")
    .order("stage_name", { ascending: true });

  const models = (data ?? []) as ModelListRow[];

  const counts = {
    total: models.length,
    active: models.filter((m) => m.status === "active").length,
    on_leave: models.filter((m) => m.status === "on_leave").length,
    terminated: models.filter((m) => m.status === "terminated").length,
  };

  const visible =
    activeFilter === "all" ? models : models.filter((m) => m.status === activeFilter);

  return (
    <>
      <PageHeader
        title={d.studio.models.title}
        description={d.studio.models.description}
        breadcrumbs={[{ label: d.studio.models.title }]}
        actions={<ModelForm mode="create" />}
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile
          label={d.studio.models.statTotal}
          value={counts.total}
          hint={d.studio.models.statTotalHint}
        />
        <StatTile
          label={d.studio.models.statActive}
          value={counts.active}
          hint={d.studio.models.statActiveHint}
        />
        <StatTile
          label={d.studio.models.statOnLeave}
          value={counts.on_leave}
          hint={d.studio.models.statOnLeaveHint}
        />
        <StatTile
          label={d.studio.models.statTerminated}
          value={counts.terminated}
          hint={d.studio.models.statTerminatedHint}
        />
      </StatTileRow>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StatusFilter current={activeFilter} />
        <span className="text-xs text-muted">
          {d.studio.models.shown(visible.length, counts.total)}
        </span>
      </div>

      <ModelsTable rows={visible} />
    </>
  );
}
