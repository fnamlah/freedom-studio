import type { Metadata } from "next";
import { z } from "zod";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { SelectOption } from "@/components/ui/select";
import { requireRole } from "@/lib/auth/guard";
import {
  earningRecordSchema,
  expenseRecordSchema,
  matchAccount,
  sessionRecordSchema,
  type AccountCandidate,
} from "@/lib/extractions";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";

import { documentTypeLabel, documentTypeOptions, DOCUMENT_TYPES } from "../doc-meta";
import {
  InboxList,
  type MetaFieldKey,
  type MetaFieldView,
  type ProposalView,
} from "./inbox-list";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).documents.inbox.metaTitle };
}

/**
 * The review inbox (021) — Super Admin + Manager, the same people the manual
 * entry forms allow. Everything here is READ + prep: payloads are parsed
 * defensively (a row that fails its schema renders as an unreadable card with
 * only Dismiss), printed platform/username pairs are resolved to accounts
 * where unambiguous, and enum values get their localized labels. The writes
 * live in `actions.ts` and are validated again there — this page's prep is UX,
 * never the gate.
 */
export default async function InboxPage() {
  const { supabase } = await requireRole("super_admin", "manager");
  const d = await getDict();
  const fm = fmt(await getLocale());

  const { data: extractionsRaw } = await supabase
    .from("doc_extractions")
    .select("id, source_kind, source_id, kind, payload, confidence, created_at")
    .eq("state", "proposed")
    .order("created_at", { ascending: true });
  const extractions = extractionsRaw ?? [];

  const libraryIds = extractions
    .filter((e) => e.source_kind === "library_file")
    .map((e) => e.source_id);
  const documentIds = extractions
    .filter((e) => e.source_kind === "document")
    .map((e) => e.source_id);

  const [filesRes, docsRes, accountsRes, platformsRes, modelsRes] = await Promise.all([
    libraryIds.length
      ? supabase.from("library_files").select("id, name").in("id", libraryIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    documentIds.length
      ? supabase
          .from("documents")
          .select("id, title, doc_type, issued_date, expires_at")
          .in("id", documentIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            title: string;
            doc_type: string;
            issued_date: string | null;
            expires_at: string | null;
          }[],
        }),
    supabase.from("platform_accounts").select("id, username, model_id, platform_id"),
    supabase.from("platforms").select("id, name"),
    supabase.from("models").select("id, stage_name"),
  ]);

  const fileName = new Map((filesRes.data ?? []).map((f) => [f.id, f.name]));
  const docRow = new Map((docsRes.data ?? []).map((doc) => [doc.id, doc]));
  const platformName = new Map((platformsRes.data ?? []).map((p) => [p.id, p.name]));
  const modelName = new Map((modelsRes.data ?? []).map((m) => [m.id, m.stage_name]));

  const accounts = accountsRes.data ?? [];
  const candidates: AccountCandidate[] = accounts.map((a) => ({
    id: a.id,
    username: a.username,
    platformName: platformName.get(a.platform_id) ?? "",
  }));
  const accountOptions: SelectOption[] = accounts
    .map((a) => ({
      value: a.id,
      label: `${modelName.get(a.model_id) ?? d.money.schemes.unknownModel} · ${
        platformName.get(a.platform_id) ?? d.money.schemes.unknownPlatform
      } (@${a.username})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const proposals: ProposalView[] = extractions.map((e) => {
    const base = {
      id: e.id,
      sourceLabel:
        e.source_kind === "library_file"
          ? fileName.get(e.source_id) ?? ""
          : docRow.get(e.source_id)?.title ?? "",
      sourceGone:
        e.source_kind === "library_file"
          ? !fileName.has(e.source_id)
          : !docRow.has(e.source_id),
      createdAt: fm.date(e.created_at),
      confidenceLabel: e.confidence != null ? fm.percent(Math.round(e.confidence * 100)) : null,
    };

    if (e.kind === "earnings") {
      const parsed = rowsSchema(earningRecordSchema).safeParse(e.payload);
      if (!parsed.success) return { ...base, kind: "invalid" as const, originalKind: e.kind };
      return {
        ...base,
        kind: "earnings" as const,
        rows: parsed.data.rows.map((r) => ({
          platform_account_id: matchAccount(r, candidates) ?? "",
          printedPlatform: r.platform ?? "",
          printedUsername: r.username ?? "",
          period_start: r.period_start,
          period_end: r.period_end,
          gross_amount: String(r.gross_amount),
          platform_fee_amount: String(r.fee_amount ?? 0),
          net_amount: String(r.net_amount),
          currency: r.currency ?? "USD",
        })),
      };
    }

    if (e.kind === "sessions") {
      const parsed = rowsSchema(sessionRecordSchema).safeParse(e.payload);
      if (!parsed.success) return { ...base, kind: "invalid" as const, originalKind: e.kind };
      return {
        ...base,
        kind: "sessions" as const,
        rows: parsed.data.rows.map((r) => ({
          platform_account_id: matchAccount(r, candidates) ?? "",
          printedPlatform: r.platform ?? "",
          printedUsername: r.username ?? "",
          started_at: r.started_at,
          ended_at: r.ended_at ?? "",
          gross_earnings: String(r.gross_earnings ?? 0),
          currency: r.currency ?? "USD",
          notes: r.notes ?? "",
        })),
      };
    }

    if (e.kind === "expenses") {
      const parsed = rowsSchema(expenseRecordSchema).safeParse(e.payload);
      if (!parsed.success) return { ...base, kind: "invalid" as const, originalKind: e.kind };
      return {
        ...base,
        kind: "expenses" as const,
        rows: parsed.data.rows.map((r) => ({
          incurred_on: r.incurred_on,
          vendor: r.vendor,
          description: r.description ?? "",
          amount: String(r.amount),
          currency: r.currency ?? "USD",
          category: r.category ?? "",
        })),
      };
    }

    // document_meta
    const parsed = metaPayloadSchema.safeParse(e.payload);
    if (!parsed.success) return { ...base, kind: "invalid" as const, originalKind: e.kind };
    const current = docRow.get(e.source_id);
    const fields = metaFieldViews(parsed.data.fields, current, d, fm.date);
    return { ...base, kind: "document_meta" as const, fields };
  });

  return (
    <>
      <PageHeader
        title={d.documents.inbox.title}
        description={d.documents.inbox.description}
        breadcrumbs={[
          { label: d.documents.title, href: "/documents" },
          { label: d.documents.inbox.title },
        ]}
      />

      {proposals.length === 0 ? (
        <EmptyState
          title={d.documents.inbox.emptyTitle}
          description={d.documents.inbox.emptyDescription}
        />
      ) : (
        <InboxList
          proposals={proposals}
          accountOptions={accountOptions}
          docTypeOptions={documentTypeOptions(d)}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- helpers --- */

/** A staged payload is `{rows: [...]}` — same shape `persistProposal` wrote. */
function rowsSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({ rows: z.array(row).min(1).max(50) });
}

const metaPayloadSchema = z.object({
  fields: z
    .object({
      doc_type: z.enum(DOCUMENT_TYPES).optional(),
      title: z.string().min(1).max(200).optional(),
      issued_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .strict(),
  current: z.unknown(),
});

/**
 * One row per proposed field, labelled against the document's CURRENT values —
 * fresh from the row, not the snapshot taken at proposal time, so a field
 * someone already fixed by hand drops out instead of proposing a no-op.
 */
function metaFieldViews(
  fields: z.infer<typeof metaPayloadSchema>["fields"],
  current:
    | { title: string; doc_type: string; issued_date: string | null; expires_at: string | null }
    | undefined,
  d: Dictionary,
  formatDate: (value: string) => string,
): MetaFieldView[] {
  const views: MetaFieldView[] = [];
  const push = (key: MetaFieldKey, proposed: string | undefined, currentLabel: string) => {
    if (!proposed) return;
    views.push({ key, currentLabel, proposed });
  };

  push(
    "doc_type",
    fields.doc_type !== current?.doc_type ? fields.doc_type : undefined,
    current ? documentTypeLabel(d, current.doc_type) : "",
  );
  push(
    "title",
    fields.title !== current?.title ? fields.title : undefined,
    current?.title ?? "",
  );
  push(
    "issued_date",
    fields.issued_date !== current?.issued_date ? fields.issued_date : undefined,
    current?.issued_date ? formatDate(current.issued_date) : "",
  );
  push(
    "expires_at",
    fields.expires_at !== current?.expires_at ? fields.expires_at : undefined,
    current?.expires_at ? formatDate(current.expires_at) : "",
  );
  return views;
}
