import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

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
 *
 * The report's own `title` and body are NOT translated — they are content the
 * model produced, in whatever language it was asked for.
 */
export async function AiInsightPanel({
  report,
  className,
}: {
  report: AiInsight | null;
  className?: string;
}) {
  const d = await getDict();
  const fm = fmt(await getLocale());

  if (!report) {
    return (
      <Card className={className}>
        <CardHeader title={d.money.dashboard.aiInsightTitle} />
        <CardBody>
          <EmptyState
            bare
            title={d.money.dashboard.aiInsightEmptyTitle}
            description={d.money.dashboard.aiInsightEmptyDesc}
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
        title={d.money.dashboard.aiInsightTitle}
        description={d.money.dashboard.aiInsightHeading(
          fm.month(report.report_month),
          report.title,
        )}
        action={<Badge variant="muted">{report.provider}</Badge>}
      />
      <CardBody>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {preview}
          {truncated ? "…" : ""}
        </p>
        <p className="mt-3 text-xs text-muted">
          {d.money.dashboard.aiInsightFooter(fm.dateTime(report.created_at), report.model)}
        </p>
      </CardBody>
    </Card>
  );
}
