import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { getDict } from "@/lib/i18n/server";

import { deriveComplianceStatus, type ComplianceStatus } from "./doc-meta";
import { DocumentUpload, type ModelOption } from "./document-upload";
import { normaliseKeyFigures } from "./ai-meta";
import { DocumentsTable, type DocumentRow } from "./documents-table";
import { ModelFilter } from "./model-filter";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).documents.metaTitle };
}

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
  ai_analysis_opt_in: boolean;
  ai_status: string;
  ai_summary: string | null;
  ai_key_figures: unknown;
  analysed_at: string | null;
  analysed_provider: string | null;
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
  const d = await getDict();

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
      "id, model_id, doc_type, title, file_name, mime_type, file_size_bytes, issued_date, expires_at, is_archived, created_at, ai_analysis_opt_in, ai_status, ai_summary, ai_key_figures, analysed_at, analysed_provider",
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

  // `doc`, not `d` — `d` is the dictionary in this scope.
  const rows: DocumentRow[] = documents.map((doc) => ({
    id: doc.id,
    model_id: doc.model_id,
    model_name: modelName.get(doc.model_id) ?? d.documents.unknownModel,
    doc_type: doc.doc_type,
    title: doc.title,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
    file_size_bytes: doc.file_size_bytes,
    issued_date: doc.issued_date,
    expires_at: doc.expires_at,
    is_archived: doc.is_archived,
    status: deriveComplianceStatus(doc.expires_at),
    ai_analysis_opt_in: doc.ai_analysis_opt_in,
    ai_status: doc.ai_status,
    ai_summary: doc.ai_summary,
    ai_key_figures: normaliseKeyFigures(doc.ai_key_figures),
    analysed_at: doc.analysed_at,
    analysed_provider: doc.analysed_provider,
  }));

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { valid: 0, expiring: 0, expired: 0 } as Record<ComplianceStatus, number>,
  );

  const scopeHint =
    activeModelFilter === "all" ? d.documents.scopeAll : d.documents.scopeFiltered;

  return (
    <>
      <PageHeader
        title={d.documents.title}
        description={d.documents.description}
        breadcrumbs={[{ label: d.documents.title }]}
        actions={<DocumentUpload models={modelOptions} />}
      />

      {models.length === 0 ? (
        <EmptyState
          title={d.documents.noModelsTitle}
          description={d.documents.noModelsDescription}
        />
      ) : (
        <>
          <StatTileRow className="mb-6" columns={4}>
            <StatTile
              label={d.documents.statDocuments}
              value={rows.length}
              hint={scopeHint}
            />
            <StatTile
              label={d.documents.statValid}
              value={counts.valid}
              hint={d.documents.statValidHint}
            />
            <StatTile
              label={d.documents.statExpiring}
              value={counts.expiring}
              hint={d.documents.statExpiringHint}
            />
            <StatTile
              label={d.documents.statExpired}
              value={counts.expired}
              hint={d.documents.statExpiredHint}
            />
          </StatTileRow>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <ModelFilter current={activeModelFilter} models={modelOptions} />
            <span className="text-xs text-muted">{d.documents.shown(rows.length)}</span>
          </div>

          <DocumentsTable rows={rows} />
        </>
      )}
    </>
  );
}
