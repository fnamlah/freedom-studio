import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import type { SelectOption } from "@/components/ui/select";
import { requireRole } from "@/lib/auth/guard";
import { isoDate } from "@/lib/format";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { ResolutionExplainer } from "./resolution-explainer";
import { SchemeForm } from "./scheme-form";
import { SchemesTable } from "./schemes-table";
import { deriveScope, deriveStatus, SCOPE_META, type SchemeRowView } from "./scheme-meta";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).money.schemes.metaTitle };
}

/**
 * Commission schemes — Super Admin writes, Manager reads (docs/03 §3: schemes are
 * `CRUD` for SA, `read` for MGR; docs/09 §4). The page is gated to SA + MGR
 * (matching the nav map); write controls render only for the Super Admin, whose
 * server actions re-check the role as the hard gate.
 *
 * Read through the caller's own RLS-scoped client. Scheme rows carry only the two
 * nullable scope FKs, so we resolve human labels here from the models / accounts /
 * platforms lists (also reused as the create dialog's select options), keeping the
 * client table free of any join logic.
 */
export default async function SchemesPage() {
  const { supabase, role } = await requireRole("super_admin", "manager");
  const d = await getDict();
  const fm = fmt(await getLocale());
  const canWrite = role === "super_admin";
  // ISO for the comparison (lexicographic on ISO dates is exact); the tile
  // renders the same instant through the locale formatter.
  const todayIso = isoDate(new Date());

  const [schemesRes, modelsRes, accountsRes, platformsRes] = await Promise.all([
    supabase
      .from("commission_schemes")
      .select(
        "id, model_id, platform_account_id, model_percent, operator_percent, studio_percent, effective_from, effective_to, notes, created_at",
      )
      .order("effective_from", { ascending: false }),
    supabase.from("models").select("id, stage_name").order("stage_name", { ascending: true }),
    supabase
      .from("platform_accounts")
      .select("id, username, model_id, platform_id")
      .order("username", { ascending: true }),
    supabase.from("platforms").select("id, name"),
  ]);

  const schemes = schemesRes.data ?? [];
  const models = modelsRes.data ?? [];
  const accounts = accountsRes.data ?? [];
  const platforms = platformsRes.data ?? [];

  const modelName = new Map(models.map((m) => [m.id, m.stage_name]));
  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const accountLabel = new Map(
    accounts.map((a) => {
      const model = modelName.get(a.model_id) ?? d.money.schemes.unknownModel;
      const platform = platformName.get(a.platform_id) ?? d.money.schemes.unknownPlatform;
      return [a.id, `${model} · ${platform} (@${a.username})`] as const;
    }),
  );

  const rows: SchemeRowView[] = schemes
    .map((s) => {
      const scope = deriveScope(s);
      const scopeLabel =
        scope === "account"
          ? accountLabel.get(s.platform_account_id ?? "") ?? d.money.schemes.unknownAccount
          : scope === "model"
            ? modelName.get(s.model_id ?? "") ?? d.money.schemes.unknownModel
            : d.money.schemes.studioDefault;

      return {
        id: s.id,
        scope,
        scopeLabel,
        model_percent: s.model_percent,
        operator_percent: s.operator_percent,
        studio_percent: s.studio_percent,
        effective_from: s.effective_from,
        effective_to: s.effective_to,
        notes: s.notes,
        status: deriveStatus(s.effective_from, s.effective_to, todayIso),
        isDefault: scope === "default",
        model_id: s.model_id,
        platform_account_id: s.platform_account_id,
      } satisfies SchemeRowView;
    })
    .sort((a, b) => {
      // Within the whole list; the table re-groups by scope. Keep a stable,
      // readable order: scope (resolution order) → label → newest effective first.
      if (SCOPE_META[a.scope].order !== SCOPE_META[b.scope].order) {
        return SCOPE_META[a.scope].order - SCOPE_META[b.scope].order;
      }
      if (a.scopeLabel !== b.scopeLabel) return a.scopeLabel.localeCompare(b.scopeLabel);
      return b.effective_from.localeCompare(a.effective_from);
    });

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    model: rows.filter((r) => r.scope === "model").length,
    account: rows.filter((r) => r.scope === "account").length,
  };

  const modelOptions: SelectOption[] = models.map((m) => ({ value: m.id, label: m.stage_name }));
  const accountOptions: SelectOption[] = accounts
    .map((a) => ({ value: a.id, label: accountLabel.get(a.id) ?? a.username }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <PageHeader
        title={d.money.schemes.title}
        description={d.money.schemes.description}
        breadcrumbs={[{ label: d.money.schemes.title }]}
        actions={
          canWrite ? (
            <SchemeForm
              mode="create"
              modelOptions={modelOptions}
              accountOptions={accountOptions}
            />
          ) : undefined
        }
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile
          label={d.money.schemes.statTotal}
          value={fm.number(counts.total)}
          hint={d.money.schemes.statTotalHint}
        />
        <StatTile
          label={d.money.schemes.statActive}
          value={fm.number(counts.active)}
          hint={d.money.schemes.statActiveHint(fm.date(todayIso))}
        />
        <StatTile
          label={d.money.schemes.statModel}
          value={fm.number(counts.model)}
          hint={d.money.schemes.statModelHint}
        />
        <StatTile
          label={d.money.schemes.statAccount}
          value={fm.number(counts.account)}
          hint={d.money.schemes.statAccountHint}
        />
      </StatTileRow>

      <div className="mb-6">
        <ResolutionExplainer />
      </div>

      <SchemesTable rows={rows} canWrite={canWrite} />
    </>
  );
}
