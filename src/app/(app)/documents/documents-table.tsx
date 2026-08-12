"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { getDownloadUrl } from "./actions";
import { AnalysisManager } from "./analysis-manager";
import type { KeyFigure } from "./ai-meta";
import {
  COMPLIANCE_META,
  type ComplianceStatus,
  documentTypeLabel,
} from "./doc-meta";
import { ShareManager } from "./share-manager";

export type DocumentRow = {
  id: string;
  model_id: string;
  model_name: string;
  doc_type: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  issued_date: string | null;
  expires_at: string | null;
  is_archived: boolean;
  status: ComplianceStatus;
  ai_analysis_opt_in: boolean;
  ai_status: string;
  ai_summary: string | null;
  ai_key_figures: KeyFigure[];
  analysed_at: string | null;
  analysed_provider: string | null;
};

/**
 * Per-model compliance document list (SA/MGR only). Each row downloads (a fresh
 * 60-second signed URL from the server, audited) or opens its share-link manager.
 * The compliance badge is derived from `expires_at` (docs/06 §4) — never stored.
 */
export function DocumentsTable({ rows }: { rows: DocumentRow[] }) {
  const d = useDict();
  const fm = fmt(useLocale());

  if (rows.length === 0) {
    return (
      <EmptyState
        title={d.documents.emptyTitle}
        description={d.documents.emptyDescription}
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>{d.documents.colModel}</TH>
          <TH>{d.documents.colDocument}</TH>
          <TH>{d.documents.colType}</TH>
          <TH>{d.documents.colIssued}</TH>
          <TH>{d.documents.colExpires}</TH>
          <TH>{d.documents.colCompliance}</TH>
          <TH align="right">{d.documents.colSize}</TH>
          <TH align="right">{d.common.actions}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const meta = COMPLIANCE_META[row.status];
          return (
            <TR key={row.id}>
              <TD className="font-medium text-foreground">{row.model_name}</TD>
              <TD>
                <span className="font-medium text-foreground">{row.title}</span>
                <span className="block text-xs text-muted">{row.file_name}</span>
              </TD>
              <TD className="text-muted">{documentTypeLabel(d, row.doc_type)}</TD>
              <TD className="text-muted">
                {row.issued_date ? fm.date(row.issued_date) : EM_DASH}
              </TD>
              <TD className="text-muted">
                {row.expires_at ? fm.date(row.expires_at) : EM_DASH}
              </TD>
              <TD>
                <div className="flex items-center gap-2">
                  <Badge variant={meta.variant} dot>
                    {d.documents.compliance[row.status]}
                  </Badge>
                  {row.is_archived ? (
                    <Badge variant="muted">{d.documents.archived}</Badge>
                  ) : null}
                </div>
              </TD>
              <TD numeric className="text-muted">
                {fm.fileSize(row.file_size_bytes)}
              </TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <DownloadButton id={row.id} />
                  <AnalysisManager
                    documentId={row.id}
                    documentTitle={row.title}
                    optedIn={row.ai_analysis_opt_in}
                    aiStatus={row.ai_status}
                    summary={row.ai_summary}
                    keyFigures={row.ai_key_figures}
                    analysedProvider={row.analysed_provider}
                  />
                  <ShareManager documentId={row.id} documentTitle={row.title} />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

/**
 * Requests a signed URL, then opens it. A blank tab is opened synchronously on
 * click so the later navigation isn't caught by a popup blocker; on failure it is
 * closed. The signed URL is never rendered into the page or the address bar.
 */
function DownloadButton({ id }: { id: string }) {
  const { error } = useToast();
  const d = useDict();
  const [busy, setBusy] = useState(false);

  async function download() {
    const pre = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    setBusy(true);
    const res = await getDownloadUrl(id);
    setBusy(false);
    if (res.ok) {
      if (pre && !pre.closed) {
        pre.location.href = res.url;
      } else {
        const a = document.createElement("a");
        a.href = res.url;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } else {
      pre?.close();
      error(d.documents.downloadFailedTitle, res.error);
    }
  }

  return (
    <Button variant="outline" size="sm" loading={busy} onClick={download}>
      {d.common.download}
    </Button>
  );
}
