import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import type { Dictionary, Locale } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";
import { EM_DASH } from "@/lib/format";

import type { SelectOption } from "@/components/ui/select";

import { ApprovalsTable, type ApprovalRowView, type ApprovalState } from "./approvals-table";
import { PairingPanel, type PairedChannelView } from "./pairing-panel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.hermes.metaTitle };
}

/** Heartbeats older than this mean a loop is wedged, not merely idle. */
const STALE_MS = 15 * 60_000;

type PreviewShape = { summary?: unknown; [key: string]: unknown };

/**
 * The narrative keys the worker writes into `preview`, in both languages
 * (`summary_en`/`summary_ru`, `risk_en`/`risk_ru`) plus the pre-i18n
 * English-only `summary`. They are read explicitly below, so they must NOT also
 * fall through the generic key→label flattening — `summary en` is not a field a
 * person approving money should see.
 */
const NARRATIVE_KEY_RE = /^(summary|risk)(_|$)/;

/** Read `<base>_<locale>` from a preview, falling back to the other language. */
function localizedPreviewText(
  obj: PreviewShape,
  base: "summary" | "risk",
  locale: Locale,
): string | null {
  const candidates = [
    obj[`${base}_${locale}`],
    obj[`${base}_${locale === "ru" ? "en" : "ru"}`],
    // Rows written before the worker started emitting both languages carry only
    // the bare, English `summary`; the chain has to reach them.
    obj[base],
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Turn a proposal's stored preview into something readable without trusting it.
 *
 * `preview` is written by the worker, so it is ours — but it is still JSON of
 * unknown shape, and it is rendered to the person about to authorise money. It
 * gets flattened to scalar label/value pairs; nested objects are dropped rather
 * than stringified into noise.
 */
function describePreview(
  preview: unknown,
  locale: Locale,
  fallback: string,
): { summary: string; risk: string | null; details: ApprovalRowView["details"] } {
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
    return { summary: fallback, risk: null, details: [] };
  }
  const obj = preview as PreviewShape;
  const summary = localizedPreviewText(obj, "summary", locale) ?? fallback;
  const risk = localizedPreviewText(obj, "risk", locale);

  const details: ApprovalRowView["details"] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (NARRATIVE_KEY_RE.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    details.push({
      label: key.replace(/_/g, " "),
      value: String(value),
    });
    if (details.length >= 6) break;
  }
  return { summary, risk, details };
}

/**
 * `hermes_job_runs.status` is a DB value, so it is never translated — only its
 * label is. An unrecognised status falls through as its raw value rather than
 * rendering blank: a new worker status must still be legible here.
 */
function jobStatusLabel(status: string, d: Dictionary["adminAi"]["hermes"]): string {
  if (status === "success") return d.jobSuccess;
  if (status === "running") return d.jobRunning;
  if (status === "failed" || status === "error") return d.jobFailed;
  return status;
}

export default async function HermesPage() {
  // Super Admin only. RLS on every hermes_* table already restricts SELECT to
  // super_admin, so a lower role reaching this route reads nothing regardless.
  const { supabase } = await requireRole("super_admin");
  const locale = await getLocale();
  const dict = await getDict();
  const d = dict.adminAi.hermes;
  const fm = fmt(locale);

  const [approvalsRes, jobsRes, heartbeatRes, channelsRes, eligibleRes] = await Promise.all([
    supabase
      .from("hermes_approvals")
      .select(
        "id, action_type, state, required_role, preview, risk_reason, job_name, created_at, expires_at, decided_at, decided_by, last_error, attempt_count",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("hermes_job_runs")
      .select("id, job_name, status, outcome, error, started_at, duration_ms")
      .order("started_at", { ascending: false })
      .limit(12),
    supabase.from("hermes_policy").select("key, value, updated_at").like("key", "heartbeat:%"),
    // Telegram access: who holds a live channel, and who is even eligible for
    // one. BOT_ROLES (hermes/src/telegram/access.ts) is the authority the bot
    // itself applies; mirroring it here means the picker cannot offer someone
    // a code the bot would refuse.
    supabase
      .from("hermes_channels")
      .select("id, external_id, profile_id, created_at")
      .eq("channel_type", "telegram")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("status", "active")
      .in("role", ["super_admin", "manager", "finance"])
      .order("full_name", { ascending: true }),
  ]);

  // Channel owners are looked up separately from the eligible list: a channel
  // can outlive eligibility (a role change, a deactivation), and that row is
  // exactly the one an admin needs to see clearly enough to revoke.

  const approvals = approvalsRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const heartbeats = heartbeatRes.data ?? [];
  const channels = channelsRes.data ?? [];
  const botEligible = eligibleRes.data ?? [];

  const ownerIds = [...new Set(channels.map((c) => c.profile_id))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, full_name, email, role, status").in("id", ownerIds)
    : { data: [] as Array<{ id: string; full_name: string; email: string; role: string; status: string }> };
  const ownerById = new Map((owners ?? []).map((p) => [p.id, p]));

  const pairedChannels: PairedChannelView[] = channels.map((c) => {
    const person = ownerById.get(c.profile_id);
    const eligible =
      person?.status === "active" &&
      ["super_admin", "manager", "finance"].includes(person.role);
    return {
      id: c.id,
      personName: person?.full_name || person?.email || d.pairing.unknownPerson,
      roleLabel:
        person && eligible
          ? dict.roles[person.role as keyof typeof dict.roles]
          : d.pairing.roleIneligible,
      chatId: c.external_id,
      pairedAt: c.created_at,
    };
  });

  const peopleOptions: SelectOption[] = botEligible.map((p) => ({
    value: p.id,
    label: `${p.full_name || p.email} · ${dict.roles[p.role as keyof typeof dict.roles]}`,
  }));

  // Resolve decider names in one round trip rather than per row.
  const deciderIds = [
    ...new Set(approvals.map((a) => a.decided_by).filter((id): id is string => Boolean(id))),
  ];
  const { data: deciders } = deciderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", deciderIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const nameOf = new Map((deciders ?? []).map((p) => [p.id, p.full_name]));

  const rows: ApprovalRowView[] = approvals.map((a) => {
    const { summary, risk, details } = describePreview(a.preview, locale, d.proposalFallback);
    return {
      id: a.id,
      action_type: a.action_type,
      state: a.state as ApprovalState,
      required_role: a.required_role,
      summary,
      details,
      // `risk_reason` on the row is English; the preview's `risk_<locale>` is
      // the translated version of the same text, so prefer it when present.
      risk_reason: risk ?? a.risk_reason,
      job_name: a.job_name,
      created_at: a.created_at,
      expires_at: a.expires_at,
      decided_at: a.decided_at,
      decider_name: a.decided_by ? (nameOf.get(a.decided_by) ?? null) : null,
      last_error: a.last_error,
      attempt_count: a.attempt_count,
    };
  });

  const pending = rows.filter((r) => r.state === "pending");
  const failed = rows.filter((r) => r.state === "failed");
  const history = rows.filter((r) => r.state !== "pending");

  const now = Date.now();
  const staleLoops = heartbeats.filter((h) => {
    const last = typeof h.value === "string" ? Date.parse(h.value) : NaN;
    return Number.isNaN(last) || now - last > STALE_MS;
  });

  const agentLive = heartbeats.length > 0 && staleLoops.length === 0;

  return (
    <>
      <PageHeader title={d.title} description={d.description} />

      <StatTileRow>
        <StatTile label={d.statAwaiting} value={String(pending.length)} />
        <StatTile label={d.statFailed} value={String(failed.length)} />
        <StatTile
          label={d.statAgent}
          value={
            agentLive
              ? d.agentRunning
              : heartbeats.length === 0
                ? d.agentNeverStarted
                : d.agentStalled
          }
        />
      </StatTileRow>

      <Card className="mt-6">
        <CardHeader title={d.awaitingCardTitle} />
        <CardBody>
          <ApprovalsTable rows={pending} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title={d.pairing.cardTitle} description={d.pairing.cardDescription} />
        <CardBody>
          <PairingPanel channels={pairedChannels} peopleOptions={peopleOptions} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title={d.healthTitle} description={d.healthDescription} />
        <CardBody>
          {heartbeats.length === 0 ? (
            <EmptyState
              title={d.noHeartbeatsTitle}
              description={d.noHeartbeatsDescription}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{d.colLoop}</TH>
                  <TH>{d.colLastHeartbeat}</TH>
                  <TH>{d.colState}</TH>
                </TR>
              </THead>
              <TBody>
                {heartbeats.map((h) => {
                  const last = typeof h.value === "string" ? h.value : null;
                  const stale = !last || now - Date.parse(last) > STALE_MS;
                  return (
                    <TR key={h.key}>
                      <TD className="font-medium">{h.key.replace("heartbeat:", "")}</TD>
                      <TD className="text-muted">{last ? fm.dateTime(last) : EM_DASH}</TD>
                      <TD>
                        <Badge variant={stale ? "danger" : "success"}>
                          {stale ? d.loopStalled : d.loopHealthy}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title={d.jobsTitle} />
        <CardBody>
          {jobs.length === 0 ? (
            <EmptyState title={d.noJobsTitle} description={d.noJobsDescription} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{d.colJob}</TH>
                  <TH>{d.colStarted}</TH>
                  <TH>{d.colResult}</TH>
                  <TH>{dict.common.status}</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD className="font-medium">{j.job_name}</TD>
                    <TD className="whitespace-nowrap text-muted">{fm.dateTime(j.started_at)}</TD>
                    <TD className="text-sm">{j.outcome ?? j.error ?? EM_DASH}</TD>
                    <TD>
                      <Badge
                        variant={
                          j.status === "success"
                            ? "success"
                            : j.status === "running"
                              ? "primary"
                              : "danger"
                        }
                      >
                        {jobStatusLabel(j.status, d)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title={d.historyTitle} description={d.historyDescription} />
        <CardBody>
          <ApprovalsTable rows={history} />
        </CardBody>
      </Card>
    </>
  );
}
