import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getActiveProviderId, isAiConfigured } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth/guard";
import { dateTime, month as fmtMonth } from "@/lib/format";

import { GenerateReportButton } from "./generate-report-button";
import { ReportMarkdown } from "./report-markdown";

export const metadata: Metadata = { title: "AI market reports" };

/** Human labels for the two switchable providers (docs/11 §3). */
const PROVIDER_LABEL: Record<string, string> = {
  moonshot: "Kimi K3 · Moonshot",
  zhipu: "GLM 5.2 · Zhipu",
};

type ReportRow = {
  id: string;
  report_month: string;
  title: string;
  content_md: string;
  provider: string;
  model: string;
  created_at: string;
};

/**
 * AI market reports (docs/11 §7) — Super Admin + Finance only.
 *
 * Lists the stored `ai_reports` and offers the "Generate monthly report" action.
 * Reports are readable by SA + Finance only because their inputs include the
 * SA/FIN-only split-distribution, payee-balance and forecast-accuracy widgets
 * (docs/11 §7). Both the list read and the generate action run under the caller's
 * own RLS/role gate; when AI is unconfigured the surface degrades gracefully —
 * the history stays visible and the generate control is disabled.
 */
export default async function AiReportsPage() {
  const { supabase } = await requireRole("super_admin", "finance");

  const [configured, activeProvider, reportsRes] = await Promise.all([
    isAiConfigured(),
    getActiveProviderId(),
    supabase
      .from("ai_reports")
      .select("id, report_month, title, content_md, provider, model, created_at")
      .order("report_month", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const reports = (reportsRes.data ?? []) as ReportRow[];
  const latest = reports[0];
  const previous = reports.slice(1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI market reports"
        description="Monthly commentary generated from the studio's own aggregate figures. Only de-identified aggregates ever reach the AI provider."
        actions={<GenerateReportButton disabled={!configured} />}
      />

      {!configured ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">AI is not configured. </span>
              Set the active provider&apos;s API key to generate new reports. Any reports already
              generated remain readable below.
            </p>
          </CardBody>
        </Card>
      ) : (
        <p className="text-xs text-muted">
          Active provider:{" "}
          <span className="text-foreground">{PROVIDER_LABEL[activeProvider] ?? activeProvider}</span>
        </p>
      )}

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description={
            configured
              ? "Generate this month's report to build a commentary from the studio's earnings, split distribution, forecast and balances."
              : "When AI is configured, generate a monthly report to build a commentary from the studio's own aggregates."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          <ReportCard report={latest} highlighted />

          {previous.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Earlier reports</h2>
              <div className="flex flex-col gap-2">
                {previous.map((report) => (
                  <details
                    key={report.id}
                    className="group rounded-lg border border-border bg-surface"
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="font-medium text-foreground">{report.title}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <span>{fmtMonth(report.report_month)}</span>
                        <Badge variant="muted">
                          {PROVIDER_LABEL[report.provider] ?? report.provider}
                        </Badge>
                      </span>
                    </summary>
                    <div className="border-t border-border px-4 py-3">
                      <ReportMarkdown content={report.content_md} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, highlighted }: { report: ReportRow; highlighted?: boolean }) {
  return (
    <Card>
      <CardHeader
        title={report.title}
        description={`Generated ${dateTime(report.created_at)} · ${report.model}`}
        action={
          <div className="flex items-center gap-2">
            {highlighted ? <Badge variant="primary">Latest</Badge> : null}
            <Badge variant="muted">{PROVIDER_LABEL[report.provider] ?? report.provider}</Badge>
          </div>
        }
      />
      <CardBody>
        <ReportMarkdown content={report.content_md} />
      </CardBody>
    </Card>
  );
}
