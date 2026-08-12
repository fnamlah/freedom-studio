import type { Metadata } from "next";
import Link from "next/link";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { roleLabel, type Role } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/guard";
import type { Json } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";
import { EM_DASH } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.auditLog.metaTitle };
}

const PAGE_SIZE = 50;

const PAGER_LINK =
  "inline-flex h-8 items-center justify-center rounded-md border border-border px-3 " +
  "text-xs font-medium text-foreground transition-colors hover:bg-surface-2";
const PAGER_DISABLED = "pointer-events-none text-muted opacity-50";

type AuditRow = {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_role: Role | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Json;
  ip: string | null;
};

type ProfileLite = { id: string; full_name: string; email: string; role: Role };

/**
 * The action-prefix filter. The PREFIXES are `audit_log.action` values and are
 * never translated — they go into the query — so only the order lives here and
 * the label for each is read from `d.auditLog.actionGroups` at render time.
 */
type ActionGroupKey = keyof Dictionary["adminAi"]["auditLog"]["actionGroups"];

const ACTION_GROUP_KEYS: readonly ActionGroupKey[] = [
  "all",
  "ai",
  "settings",
  "user",
  "auth",
  "account",
  "model",
  "operator",
  "platform",
  "session",
  "earning",
  "scheme",
  "ledger",
  "payout",
  "forecast",
  "document",
  "share",
  "library",
];
/** `all` is the empty filter; every other key IS the prefix it filters on. */
const ALLOWED_PREFIXES = new Set<string>(ACTION_GROUP_KEYS.filter((k) => k !== "all"));

/**
 * The dotted-verb catalogue legend (docs/04 §4.16, docs/05 §9). AI-governance
 * verbs first — those are the reason this viewer exists alongside the AI
 * settings surface.
 *
 * Only the STRUCTURE lives here: which verbs belong to which group, and in what
 * order. The verbs themselves are `audit_log.action` values (never translated),
 * and each one's gloss comes from `d.auditLog.verbs`.
 */
type VerbKey = keyof Dictionary["adminAi"]["auditLog"]["verbs"];
type GroupTitleKey = "catalogGroupAi" | "catalogGroupUsers" | "catalogGroupDocuments" | "catalogGroupMoney";

const VERB_CATALOG: ReadonlyArray<{
  titleKey: GroupTitleKey;
  verbs: readonly VerbKey[];
}> = [
  {
    titleKey: "catalogGroupAi",
    verbs: [
      "ai.model_switch",
      "ai.settings_update",
      "ai.classify",
      "ai.reindex",
      "ai.report_create",
      "settings.update",
    ],
  },
  {
    titleKey: "catalogGroupUsers",
    verbs: [
      "user.create",
      "user.invite",
      "user.deactivate",
      "user.reactivate",
      "user.role_change",
      "auth.mfa_enrolled",
      "auth.mfa_reset",
    ],
  },
  {
    titleKey: "catalogGroupDocuments",
    verbs: [
      "document.upload",
      "document.download",
      "share.create",
      "share.revoke",
      "share.view",
      "library.upload",
      "library.categorize",
    ],
  },
  {
    titleKey: "catalogGroupMoney",
    verbs: [
      "payout.create",
      "payout.approve",
      "payout.paid",
      "payout.cancel",
      "ledger.post",
      "scheme.update",
      "forecast.snapshot",
    ],
  },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function firstString(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

function verbVariant(action: string): BadgeVariant {
  if (/\.(delete|revoke|cancel|deactivate|reset)\b/.test(action)) return "danger";
  if (action.startsWith("ai.") || action.startsWith("settings.")) return "primary";
  if (action.startsWith("auth.") || action.startsWith("user.")) return "warning";
  return "neutral";
}

function scalarText(v: unknown): string {
  if (v === null || v === undefined) return EM_DASH;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function MetaCell({
  metadata,
  fieldsCount,
}: {
  metadata: Json;
  fieldsCount: (n: number) => string;
}) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return <span className="text-muted">{EM_DASH}</span>;
  }
  const obj = metadata as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return <span className="text-muted">{EM_DASH}</span>;

  // Settings changes (ai.model_switch / ai.settings_update / *.role_change etc.)
  if ("old_value" in obj || "new_value" in obj || ("from" in obj && "to" in obj)) {
    const before = "old_value" in obj ? obj.old_value : obj.from;
    const after = "new_value" in obj ? obj.new_value : obj.to;
    return (
      <span className="text-xs">
        {"key" in obj ? (
          <span className="mr-1 font-mono text-foreground">{scalarText(obj.key)}</span>
        ) : null}
        <span className="text-muted">{scalarText(before)}</span>
        <span className="mx-1 text-muted">→</span>
        <span className="text-foreground">{scalarText(after)}</span>
      </span>
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-foreground">
        {fieldsCount(keys.length)}
      </summary>
      <pre className="mt-1 max-w-md overflow-x-auto rounded bg-surface-2 p-2 text-[11px] leading-relaxed text-foreground">
        {JSON.stringify(obj, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Audit log viewer — SUPER ADMIN ONLY (docs/04 §4.16 RLS: only super_admin reads
 * `audit_log`; nobody writes or deletes it in-app). Read through the caller's own
 * RLS-scoped client, so RLS — not this page — is the boundary.
 *
 * Filterable by action prefix, actor and date range; paginated. The append-only
 * trail is the record of every security-relevant event, including the AI
 * governance verbs (ai.model_switch, ai.settings_update, ai.reindex,
 * ai.report_create) that pair with the AI settings surface.
 */
export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireRole("super_admin");
  const locale = await getLocale();
  const dict = await getDict();
  const d = dict.adminAi.auditLog;
  const fm = fmt(locale);
  const sp = await searchParams;

  const rawAction = firstString(sp.action);
  const actionPrefix = ALLOWED_PREFIXES.has(rawAction) ? rawAction : "";

  const rawActor = firstString(sp.actor);
  const actor = rawActor === "system" || UUID_RE.test(rawActor) ? rawActor : "";

  const rawFrom = firstString(sp.from);
  const from = DATE_RE.test(rawFrom) ? rawFrom : "";
  const rawTo = firstString(sp.to);
  const to = DATE_RE.test(rawTo) ? rawTo : "";

  const page = Math.max(1, Number.parseInt(firstString(sp.page), 10) || 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;

  /* ------------------------------------------------------------ actor list --- */
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .order("full_name", { ascending: true });
  const profiles = (profilesData ?? []) as ProfileLite[];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  /* ----------------------------------------------------------------- query --- */
  let query = supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_id, actor_role, action, entity_type, entity_id, metadata, ip",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (actionPrefix) query = query.ilike("action", `${actionPrefix}%`);
  if (actor === "system") query = query.is("actor_id", null);
  else if (actor) query = query.eq("actor_id", actor);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data, count } = await query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1);
  const rows = (data ?? []) as AuditRow[];

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = Boolean(actionPrefix || actor || from || to);

  function hrefFor(overrides: Record<string, string | number | undefined>): string {
    const merged: Record<string, string | number | undefined> = {
      action: actionPrefix,
      actor,
      from,
      to,
      page,
      ...overrides,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || value === "" || (key === "page" && value === 1)) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `/admin/audit-log?${qs}` : "/admin/audit-log";
  }

  const actionOptions = ACTION_GROUP_KEYS.map((key) => ({
    value: key === "all" ? "" : key,
    label: d.actionGroups[key],
  }));

  const actorOptions = [
    { value: "", label: d.allActors },
    { value: "system", label: d.systemActors },
    ...profiles.map((p) => ({
      value: p.id,
      label: `${p.full_name} · ${roleLabel(locale, p.role)}`,
    })),
  ];

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.description}
        breadcrumbs={[{ label: dict.nav.sectionAdmin }, { label: d.title }]}
      />

      <StatTileRow className="mb-6" columns={3}>
        <StatTile
          label={hasFilter ? d.statMatching : d.statTotal}
          value={fm.number(total)}
          hint={hasFilter ? d.hintFiltered : d.hintAll}
        />
        <StatTile label={d.statThisPage} value={rows.length} hint={d.hintPerPage(PAGE_SIZE)} />
        <StatTile
          label={d.statPage}
          value={`${page} / ${totalPages}`}
          hint={d.hintNewestFirst}
        />
      </StatTileRow>

      {/* -------------------------------------------------------- filters --- */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field>
              <Label htmlFor="filter-action">{d.filterAction}</Label>
              <Select
                id="filter-action"
                name="action"
                defaultValue={actionPrefix}
                options={actionOptions}
              />
            </Field>
            <Field>
              <Label htmlFor="filter-actor">{d.filterActor}</Label>
              <Select id="filter-actor" name="actor" defaultValue={actor} options={actorOptions} />
            </Field>
            <Field>
              <Label htmlFor="filter-from">{d.filterFrom}</Label>
              <Input id="filter-from" name="from" type="date" defaultValue={from} />
            </Field>
            <Field>
              <Label htmlFor="filter-to">{d.filterTo}</Label>
              <Input id="filter-to" name="to" type="date" defaultValue={to} />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit">{dict.common.apply}</Button>
              {hasFilter ? (
                <Link
                  href="/admin/audit-log"
                  className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  {dict.common.clear}
                </Link>
              ) : null}
            </div>
          </form>
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- results --- */}
      {rows.length === 0 ? (
        <EmptyState
          title={d.emptyTitle}
          description={hasFilter ? d.emptyFiltered : d.emptyAll}
        />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>{d.colWhen}</TH>
              <TH>{d.colActor}</TH>
              <TH>{d.colAction}</TH>
              <TH>{d.colTarget}</TH>
              <TH>{d.colDetails}</TH>
              <TH>{d.colIp}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const profile = row.actor_id ? profileById.get(row.actor_id) : null;
              return (
                <TR key={row.id}>
                  <TD className="whitespace-nowrap text-muted">{fm.dateTime(row.created_at)}</TD>
                  <TD>
                    {profile ? (
                      <>
                        <div className="font-medium text-foreground">{profile.full_name}</div>
                        <div className="text-xs text-muted">
                          {row.actor_role ? roleLabel(locale, row.actor_role) : profile.email}
                        </div>
                      </>
                    ) : row.actor_id ? (
                      <span className="font-mono text-xs text-muted">
                        {row.actor_id.slice(0, 8)}…
                      </span>
                    ) : (
                      <Badge variant="muted">{d.systemBadge}</Badge>
                    )}
                  </TD>
                  <TD>
                    <Badge variant={verbVariant(row.action)}>
                      <span className="font-mono">{row.action}</span>
                    </Badge>
                  </TD>
                  <TD className="text-muted">
                    {row.entity_type ? (
                      <div className="text-xs">
                        <span className="text-foreground">{row.entity_type}</span>
                        {row.entity_id ? (
                          <span className="ml-1 font-mono text-muted">
                            {row.entity_id.length > 12
                              ? `${row.entity_id.slice(0, 12)}…`
                              : row.entity_id}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      EM_DASH
                    )}
                  </TD>
                  <TD>
                    <MetaCell metadata={row.metadata} fieldsCount={d.fieldsCount} />
                  </TD>
                  <TD className="whitespace-nowrap font-mono text-xs text-muted">
                    {row.ip ?? EM_DASH}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {/* ------------------------------------------------------ pagination --- */}
      {rows.length > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {d.showingRange(rangeFrom + 1, rangeFrom + rows.length, fm.number(total))}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={hrefFor({ page: page - 1 })} className={PAGER_LINK}>
                {dict.common.previous}
              </Link>
            ) : (
              <span className={cn(PAGER_LINK, PAGER_DISABLED)}>{dict.common.previous}</span>
            )}
            {page < totalPages ? (
              <Link href={hrefFor({ page: page + 1 })} className={PAGER_LINK}>
                {dict.common.next}
              </Link>
            ) : (
              <span className={cn(PAGER_LINK, PAGER_DISABLED)}>{dict.common.next}</span>
            )}
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- legend --- */}
      <Card className="mt-8">
        <CardHeader title={d.catalogTitle} description={d.catalogDescription} />
        <CardBody>
          <div className="grid gap-6 sm:grid-cols-2">
            {VERB_CATALOG.map((group) => (
              <div key={group.titleKey}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {d[group.titleKey]}
                </h3>
                <dl className="flex flex-col gap-2">
                  {group.verbs.map((verb) => (
                    <div key={verb} className="flex flex-col gap-0.5">
                      <dt>
                        <Badge variant={verbVariant(verb)}>
                          <span className="font-mono">{verb}</span>
                        </Badge>
                      </dt>
                      <dd className="text-xs text-muted">{d.verbs[verb]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
