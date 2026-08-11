import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";

import { deriveComplianceStatus, type ComplianceStatus } from "./doc-meta";
import { DocumentUpload, type ModelOption } from "./document-upload";
import { DocumentsTable, type DocumentRow } from "./documents-table";
import { ModelFilter } from "./model-filter";

export const metadata: Metadata = { title: "Documents" };

type DocumentQueryRow = {
  id: string;
  model_id: string;
  doc_type: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  issued_date: string | null;
  expires_at: string | null;
  is_archived: boolean;
  created_at: string;
};

/**
 * Documents — compliance & identity documents, Super Admin + Manager only
 * (docs/03 §3, docs/04 §7.11: `documents` is CRUD for SA/MGR, read-own for
 * models, denied to finance and operators entirely).
 *
 * Files live in the private `model-documents` bucket; this page only ever handles
 * metadata. Retrieval is exclusively a 60-second signed URL (Download) or a
 * revocable share link (Share links) — every access is audited (docs/06). The
 * compliance badge is DERIVED from `expires_at` (docs/06 §4), never stored; the
 * derivation here matches the `v_document_compliance` view exactly.
 *
 * `storage_path` is deliberately NOT sent to the browser — downloads go through
 * the server action by document id, so the client never holds an object key.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { supabase } = await requireRole("super_admin", "manager");
  const { model } = await searchParams;

  const { data: modelsData } = await supabase
    .from("models")
    .select("id, stage_name")
    .order("stage_name", { ascending: true });
  const models = modelsData ?? [];

  const modelIds = new Set(models.map((m) => m.id));
  const activeModelFilter = model && modelIds.has(model) ? model : "all";

  let documentsQuery = supabase
    .from("documents")
    .select(
      "id, model_id, doc_type, title, file_name, mime_type, file_size_bytes, issued_date, expires_at, is_archived, created_at",
    )
    .order("created_at", { ascending: false });

  if (activeModelFilter !== "all") {
    documentsQuery = documentsQuery.eq("model_id", activeModelFilter);
  }

  const { data: documentsData } = await documentsQuery;
  const documents = (documentsData ?? []) as DocumentQueryRow[];

  const modelName = new Map(models.map((m) => [m.id, m.stage_name]));
  const modelOptions: ModelOption[] = models.map((m) => ({
    id: m.id,
    stage_name: m.stage_name,
  }));

  const rows: DocumentRow[] = documents.map((d) => ({
    id: d.id,
    model_id: d.model_id,
    model_name: modelName.get(d.model_id) ?? "Unknown model",
    doc_type: d.doc_type,
    title: d.title,
    file_name: d.file_name,
    mime_type: d.mime_type,
    file_size_bytes: d.file_size_bytes,
    issued_date: d.issued_date,
    expires_at: d.expires_at,
    is_archived: d.is_archived,
    status: deriveComplianceStatus(d.expires_at),
  }));

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { valid: 0, expiring: 0, expired: 0 } as Record<ComplianceStatus, number>,
  );

  const scopeHint = activeModelFilter === "all" ? "All models" : "Filtered model";

  return (
    <>
      <PageHeader
        title="Documents"
        description="Compliance & identity documents. Stored in a private bucket; retrieval is only ever a 60-second signed URL or a revocable, audited share link (docs/06)."
        breadcrumbs={[{ label: "Documents" }]}
        actions={<DocumentUpload models={modelOptions} />}
      />

      {models.length === 0 ? (
        <EmptyState
          title="No models yet"
          description="Compliance documents are filed against a model. Add a model first, then come back to upload identity and compliance documents."
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile label="Documents" value={rows.length} hint={scopeHint} />
            <StatTile label="Valid" value={counts.valid} hint="More than 30 days out" />
            <StatTile label="Expiring soon" value={counts.expiring} hint="Within 30 days" />
            <StatTile label="Expired" value={counts.expired} hint="Renewal required" />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{rows.length} shown</span>
          </div>

          <DocumentsTable rows={rows} />
        </>
      )}
    </>
  );
}
