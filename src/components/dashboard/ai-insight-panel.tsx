import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { dateTime, month } from "@/lib/format";

export type AiInsight = {
  title: string;
  report_month: string;
  content_md: string;
  created_at: string;
  provider: string;
  model: string;
};

/**
 * Latest AI monthly insight (docs/07 §4, sourced from `ai_reports`, generated in
 * docs/11). Rendered SA/FIN only — the query that feeds it is gated upstream. The
 * markdown body is shown as a trimmed plain-text preview: the dashboard is a
 * glance surface, and the full report lives under `/ai/reports`.
 */
export function AiInsightPanel({
  report,
  className,
}: {
  report: AiInsight | null;
  className?: string;
}) {
  if (!report) {
    return (
      <Card className={className}>
        <CardHeader title="AI monthly insight" />
        <CardBody>
          <EmptyState
            bare
            title="No report yet"
            description="Monthly market insights appear here once the first AI report is generated."
          />
        </CardBody>
      </Card>
    );
  }

  const preview = report.content_md.trim().slice(0, 900);
  const truncated = report.content_md.trim().length > preview.length;

  return (
    <Card className={className}>
      <CardHeader
        title="AI monthly insight"
        description={`${month(report.report_month)} · ${report.title}`}
        action={<Badge variant="muted">{report.provider}</Badge>}
      />
      <CardBody>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {preview}
          {truncated ? "…" : ""}
        </p>
        <p className="mt-3 text-xs text-muted">
          Generated {dateTime(report.created_at)} · {report.model}. Full report under AI · Reports.
        </p>
      </CardBody>
    </Card>
  );
}
