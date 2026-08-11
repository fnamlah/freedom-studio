"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { date, fileSize } from "@/lib/format";

import { getDownloadUrl } from "./actions";
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
};

/**
 * Per-model compliance document list (SA/MGR only). Each row downloads (a fresh
 * 60-second signed URL from the server, audited) or opens its share-link manager.
 * The compliance badge is derived from `expires_at` (docs/06 §4) — never stored.
 */
export function DocumentsTable({ rows }: { rows: DocumentRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No documents to show"
        description="No compliance documents match this view. Upload one, or clear the model filter to see the full list."
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Document</TH>
          <TH>Type</TH>
          <TH>Issued</TH>
          <TH>Expires</TH>
          <TH>Compliance</TH>
          <TH align="right">Size</TH>
          <TH align="right">Actions</TH>
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
              <TD className="text-muted">{documentTypeLabel(row.doc_type)}</TD>
              <TD className="text-muted">{row.issued_date ? date(row.issued_date) : "—"}</TD>
              <TD className="text-muted">{row.expires_at ? date(row.expires_at) : "—"}</TD>
              <TD>
                <div className="flex items-center gap-2">
                  <Badge variant={meta.variant} dot>
                    {meta.label}
                  </Badge>
                  {row.is_archived ? <Badge variant="muted">Archived</Badge> : null}
                </div>
              </TD>
              <TD numeric className="text-muted">
                {fileSize(row.file_size_bytes)}
              </TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <DownloadButton id={row.id} />
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
      error("Could not download", res.error);
    }
  }

  return (
    <Button variant="outline" size="sm" loading={busy} onClick={download}>
      Download
    </Button>
  );
}
