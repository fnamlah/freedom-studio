"use client";

import { Badge } from "@/components/ui/badge";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { AI_STATUS_META, type AiReviewStatus } from "./library-meta";

/**
 * Renders the `ai_status` state machine of docs/12 §4.3 as a status pill, with
 * the AI confidence (`numeric(4,3)`, a 0–1 ratio) appended once a suggestion
 * exists. Confidence is the reviewer's evidence, not an audit substitute.
 */
export function AiStatusBadge({
  status,
  confidence,
}: {
  status: AiReviewStatus;
  confidence?: number | null;
}) {
  const d = useDict();
  const fm = fmt(useLocale());
  const meta = AI_STATUS_META[status];
  const showConfidence =
    confidence !== null &&
    confidence !== undefined &&
    (status === "suggested" || status === "confirmed" || status === "overridden");

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={meta.variant} dot={meta.dot}>
        {d.library.aiStatus[status]}
      </Badge>
      {showConfidence ? (
        <span className="text-xs tabular-nums text-muted">
          {fm.percent(confidence * 100, { decimals: 0 })}
        </span>
      ) : null}
    </span>
  );
}
