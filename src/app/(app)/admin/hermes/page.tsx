import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import { dateTime, EM_DASH } from "@/lib/format";

import { ApprovalsTable, type ApprovalRowView, type ApprovalState } from "./approvals-table";

export const metadata: Metadata = { title: "Hermes" };

/** Heartbeats older than this mean a loop is wedged, not merely idle. */
const STALE_MS = 15 * 60_000;

type PreviewShape = { summary?: unknown; [key: string]: unknown };

/**
 * Turn a proposal's stored preview into something readable without trusting it.
 *
 * `preview` is written by the worker, so it is ours — but it is still JSON of
 * unknown shape, and it is rendered to the person about to authorise money. It
 * gets flattened to scalar label/value pairs; nested objects are dropped rather
 * than stringified into noise.
 */
function describePreview(preview: unknown): { summary: string; details: ApprovalRowView["details"] } {
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
    return { summary: "Proposal", details: [] };
  }
  const obj = preview as PreviewShape;
  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : "Proposal";

  const details: ApprovalRowView["details"] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === "summary") continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    details.push({
      label: key.replace(/_/g, " "),
      value: String(value),
    });
    if (details.length >= 6) break;
  }
  return { summary, details };
}

export default async function HermesPage() {
  // Super Admin only. RLS on every hermes_* table already restricts SELECT to
  // super_admin, so a lower role reaching this route reads nothing regardless.
  const { supabase } = await requireRole("super_admin");

  const [approvalsRes, jobsRes, heartbeatRes] = await Promise.all([
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
  ]);

  const approvals = approvalsRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const heartbeats = heartbeatRes.data ?? [];

  // Resolve decider names in one round trip rather than per row.
  const deciderIds = [
    ...new Set(approvals.map((a) => a.decided_by).filter((id): id is string => Boolean(id))),
  ];
  const { data: deciders } = deciderIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", deciderIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const nameOf = new Map((deciders ?? []).map((p) => [p.id, p.full_name]));

  const rows: ApprovalRowView[] = approvals.map((a) => {
    const { summary, details } = describePreview(a.preview);
    return {
      id: a.id,
      action_type: a.action_type,
      state: a.state as ApprovalState,
      required_role: a.required_role,
      summary,
      details,
      risk_reason: a.risk_reason,
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
      <PageHeader
        title="Hermes"
        description="The studio's agent proposes actions here and waits. It can raise work and it can carry out what you authorise, but it can never approve its own proposal — the database refuses that, not just the interface."
      />

      <StatTileRow>
        <StatTile label="Awaiting your decision" value={String(pending.length)} />
        <StatTile label="Failed" value={String(failed.length)} />
        <StatTile
          label="Agent"
          value={agentLive ? "Running" : heartbeats.length === 0 ? "Never started" : "Stalled"}
        />
      </StatTileRow>

      <Card className="mt-6">
        <CardHeader title="Awaiting decision" />
        <CardBody>
          <ApprovalsTable rows={pending} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Worker health"
          description="Each loop writes a heartbeat. A stalled loop means proposals may not be raised or carried out."
        />
        <CardBody>
          {heartbeats.length === 0 ? (
            <EmptyState
              title="No heartbeats recorded"
              description="Hermes has not run yet. Once the worker is deployed it reports here within a minute."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Loop</TH>
                  <TH>Last heartbeat</TH>
                  <TH>State</TH>
                </TR>
              </THead>
              <TBody>
                {heartbeats.map((h) => {
                  const last = typeof h.value === "string" ? h.value : null;
                  const stale = !last || now - Date.parse(last) > STALE_MS;
                  return (
                    <TR key={h.key}>
                      <TD className="font-medium">{h.key.replace("heartbeat:", "")}</TD>
                      <TD className="text-muted">{last ? dateTime(last) : EM_DASH}</TD>
                      <TD>
                        <Badge variant={stale ? "danger" : "success"}>
                          {stale ? "Stalled" : "Healthy"}
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
        <CardHeader title="Recent job runs" />
        <CardBody>
          {jobs.length === 0 ? (
            <EmptyState title="No job runs yet" description="Scheduled jobs report here once they run." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Job</TH>
                  <TH>Started</TH>
                  <TH>Result</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD className="font-medium">{j.job_name}</TD>
                    <TD className="whitespace-nowrap text-muted">{dateTime(j.started_at)}</TD>
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
                        {j.status}
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
        <CardHeader title="Decision history" description="Every proposal Hermes has raised." />
        <CardBody>
          <ApprovalsTable rows={history} />
        </CardBody>
      </Card>
    </>
  );
}
