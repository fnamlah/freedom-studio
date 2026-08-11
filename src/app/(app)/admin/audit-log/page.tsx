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
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/guard";
import type { Json } from "@/lib/database.types";
import { dateTime, EM_DASH, number as fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

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

/** The action-prefix filter options. Values are validated against this list. */
const ACTION_GROUPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All actions" },
  { value: "ai", label: "AI (ai.*)" },
  { value: "settings", label: "Settings" },
  { value: "user", label: "Users" },
  { value: "auth", label: "Auth & MFA" },
  { value: "account", label: "Platform accounts" },
  { value: "model", label: "Models" },
  { value: "operator", label: "Operators" },
  { value: "platform", label: "Platforms" },
  { value: "session", label: "Work sessions" },
  { value: "earning", label: "Earnings" },
  { value: "scheme", label: "Commission schemes" },
  { value: "ledger", label: "Ledger" },
  { value: "payout", label: "Payouts" },
  { value: "forecast", label: "Forecasts" },
  { value: "document", label: "Documents" },
  { value: "share", label: "Document shares" },
  { value: "library", label: "Library" },
];
const ALLOWED_PREFIXES = new Set(ACTION_GROUPS.map((g) => g.value).filter(Boolean));

/**
 * The dotted-verb catalogue legend (docs/04 §4.16, docs/05 §9). AI-governance
 * verbs first — those are the reason this viewer exists alongside the AI
 * settings surface.
 */
const VERB_CATALOG: ReadonlyArray<{
  group: string;
  verbs: ReadonlyArray<{ verb: string; desc: string }>;
}> = [
  {
    group: "AI & settings",
    verbs: [
      { verb: "ai.model_switch", desc: "Active AI provider switched (old → new in metadata)." },
      { verb: "ai.settings_update", desc: "An ai.* setting changed — model ID or budget." },
      { verb: "ai.classify", desc: "A Library file classified by the AI (one per provider crossing)." },
      { verb: "ai.reindex", desc: "Semantic-search embeddings rebuilt / re-embedded." },
      { verb: "ai.report_create", desc: "An AI market report was generated." },
      { verb: "settings.update", desc: "A non-AI application setting changed." },
    ],
  },
  {
    group: "Users & auth",
    verbs: [
      { verb: "user.create", desc: "A profile row was created." },
      { verb: "user.invite", desc: "An invitation was issued." },
      { verb: "user.deactivate", desc: "An account was deactivated and its sessions revoked." },
      { verb: "user.reactivate", desc: "A deactivated account was re-enabled." },
      { verb: "user.role_change", desc: "A user's role changed." },
      { verb: "auth.mfa_enrolled", desc: "A TOTP factor was enrolled." },
      { verb: "auth.mfa_reset", desc: "A user's authenticator was reset." },
    ],
  },
  {
    group: "Documents & library",
    verbs: [
      { verb: "document.upload", desc: "A compliance document was uploaded." },
      { verb: "document.download", desc: "A document was downloaded via signed URL." },
      { verb: "share.create", desc: "A shareable document link was created." },
      { verb: "share.revoke", desc: "A share link was revoked." },
      { verb: "share.view", desc: "A share link was opened by an anonymous viewer." },
      { verb: "library.upload", desc: "A Library file was uploaded." },
      { verb: "library.categorize", desc: "A Library file was filed under a category." },
    ],
  },
  {
    group: "Money",
    verbs: [
      { verb: "payout.create", desc: "A payout was drafted." },
      { verb: "payout.approve", desc: "A payout was approved (maker-checker)." },
      { verb: "payout.paid", desc: "A payout was marked paid and settled to the ledger." },
      { verb: "payout.cancel", desc: "A payout was cancelled." },
      { verb: "ledger.post", desc: "A ledger entry (adjustment / deduction / share) was posted." },
      { verb: "scheme.update", desc: "A commission scheme was created or amended." },
      { verb: "forecast.snapshot", desc: "A forecast snapshot was taken for accuracy tracking." },
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

function MetaCell({ metadata }: { metadata: Json }) {
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
        {keys.length} field{keys.length > 1 ? "s" : ""}
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

  const actorOptions = [
    { value: "", label: "All actors" },
    { value: "system", label: "System / triggers" },
    ...profiles.map((p) => ({ value: p.id, label: `${p.full_name} · ${ROLE_LABELS[p.role]}` })),
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="The append-only trail of every security-relevant event. Super Admin only; readable, never editable. Filter by action, actor and date."
        breadcrumbs={[{ label: "Admin" }, { label: "Audit log" }]}
      />

      <StatTileRow className="mb-6" columns={3}>
        <StatTile
          label={hasFilter ? "Matching events" : "Total events"}
          value={fmtNumber(total)}
          hint={hasFilter ? "For the current filter" : "Across the whole trail"}
        />
        <StatTile label="This page" value={rows.length} hint={`Up to ${PAGE_SIZE} per page`} />
        <StatTile label="Page" value={`${page} / ${totalPages}`} hint="Newest first" />
      </StatTileRow>

      {/* -------------------------------------------------------- filters --- */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field>
              <Label htmlFor="filter-action">Action</Label>
              <Select
                id="filter-action"
                name="action"
                defaultValue={actionPrefix}
                options={ACTION_GROUPS}
              />
            </Field>
            <Field>
              <Label htmlFor="filter-actor">Actor</Label>
              <Select id="filter-actor" name="actor" defaultValue={actor} options={actorOptions} />
            </Field>
            <Field>
              <Label htmlFor="filter-from">From</Label>
              <Input id="filter-from" name="from" type="date" defaultValue={from} />
            </Field>
            <Field>
              <Label htmlFor="filter-to">To</Label>
              <Input id="filter-to" name="to" type="date" defaultValue={to} />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit">Apply</Button>
              {hasFilter ? (
                <Link
                  href="/admin/audit-log"
                  className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </form>
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- results --- */}
      {rows.length === 0 ? (
        <EmptyState
          title="No matching events"
          description={
            hasFilter
              ? "Nothing in the trail matches this filter. Widen the date range or clear the filter."
              : "The audit trail is empty. Events appear here as soon as they are recorded."
          }
        />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Target</TH>
              <TH>Details</TH>
              <TH>IP</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const profile = row.actor_id ? profileById.get(row.actor_id) : null;
              return (
                <TR key={row.id}>
                  <TD className="whitespace-nowrap text-muted">{dateTime(row.created_at)}</TD>
                  <TD>
                    {profile ? (
                      <>
                        <div className="font-medium text-foreground">{profile.full_name}</div>
                        <div className="text-xs text-muted">
                          {row.actor_role ? ROLE_LABELS[row.actor_role] : profile.email}
                        </div>
                      </>
                    ) : row.actor_id ? (
                      <span className="font-mono text-xs text-muted">
                        {row.actor_id.slice(0, 8)}…
                      </span>
                    ) : (
                      <Badge variant="muted">System</Badge>
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
                    <MetaCell metadata={row.metadata} />
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
            Showing {rangeFrom + 1}–{rangeFrom + rows.length} of {fmtNumber(total)}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={hrefFor({ page: page - 1 })} className={PAGER_LINK}>
                Previous
              </Link>
            ) : (
              <span className={cn(PAGER_LINK, PAGER_DISABLED)}>Previous</span>
            )}
            {page < totalPages ? (
              <Link href={hrefFor({ page: page + 1 })} className={PAGER_LINK}>
                Next
              </Link>
            ) : (
              <span className={cn(PAGER_LINK, PAGER_DISABLED)}>Next</span>
            )}
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- legend --- */}
      <Card className="mt-8">
        <CardHeader
          title="Verb catalogue"
          description="The canonical dotted-verb vocabulary of the audit trail (docs/04 §4.16, docs/05 §9)."
        />
        <CardBody>
          <div className="grid gap-6 sm:grid-cols-2">
            {VERB_CATALOG.map((group) => (
              <div key={group.group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.group}
                </h3>
                <dl className="flex flex-col gap-2">
                  {group.verbs.map((entry) => (
                    <div key={entry.verb} className="flex flex-col gap-0.5">
                      <dt>
                        <Badge variant={verbVariant(entry.verb)}>
                          <span className="font-mono">{entry.verb}</span>
                        </Badge>
                      </dt>
                      <dd className="text-xs text-muted">{entry.desc}</dd>
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
