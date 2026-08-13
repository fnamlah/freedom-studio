"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { appBaseUrl, optionalEnv } from "@/lib/env";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";
import { analyseDraft } from "@/lib/ai/analyse-document";
import { checkBudget, recordUsage } from "@/lib/ai/budget";
import { isAiConfigured } from "@/lib/ai/provider";
import type { AiSupabaseClient } from "@/lib/ai/types";
import type { KeyFigure } from "@/lib/ai/classify";
import { describeDbError, firstIssue, type SqlStateMessages } from "@/lib/forms";

import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_TYPES,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
} from "./doc-meta";

/**
 * Documents module — Super Admin + Manager only (docs/03 §3, docs/04 §7.11:
 * `documents` is CRUD for SA/MGR, read-own for models, deny for finance and
 * operators; `document_shares` is SA-full / MGR-insert+select+revoke).
 *
 * Everything the browser can trigger passes through one of these server actions.
 * Each opens with `requireRole("super_admin", "manager")`, which redirects an
 * unauthorized caller before any work runs, then works through the caller's own
 * RLS-scoped client — SA/MGR hold read+write on both the `model-documents`
 * bucket (docs/06 §2.3, migration 010) and the metadata tables, so RLS stays the
 * final authority. Every mutation and every retrieval appends an `audit_log` row
 * (docs/06 §6): who could have seen this file, and when.
 *
 * SHARE TOKEN HASHING is kept byte-for-byte identical to the `share-view` Edge
 * Function (supabase/functions/share-view/index.ts): the token hash is
 * `SHA-256(SHARE_TOKEN_PEPPER || token)` as lowercase hex. With no pepper set
 * this is plain `SHA-256(token)` — the form docs/06 §5.1 specifies. The raw
 * token is returned to the creator exactly once and never persisted.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const DOCUMENTS_BUCKET = "model-documents";

/** Optional pepper — MUST equal the Edge Function's `SHARE_TOKEN_PEPPER`. */
const SHARE_TOKEN_PEPPER = optionalEnv("SHARE_TOKEN_PEPPER", "") ?? "";

/* -------------------------------------------------------------- validation --- */

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return (
    asDate.getUTCFullYear() === y &&
    asDate.getUTCMonth() === m - 1 &&
    asDate.getUTCDate() === d
  );
}

/**
 * The schemas are FACTORIES rather than module constants: a `z.object(...)`
 * evaluated at import time is built long before any request exists, so it cannot
 * know the caller's language. Each action builds its schema once it holds the
 * auth context — that is what lets a validation message come back in Russian.
 */
const dateOnly = (d: Dictionary) =>
  z.string().refine(isValidYmd, d.documents.actions.invalidDate);

const optionalDate = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    dateOnly(d).nullable(),
  );

const uploadMetaSchema = (d: Dictionary) =>
  z.object({
    model_id: z.string().uuid(d.documents.actions.chooseModel),
    doc_type: z.enum(DOCUMENT_TYPES),
    title: z
      .string()
      .trim()
      .min(1, d.documents.actions.titleRequired)
      .max(200, d.documents.actions.titleTooLong),
    issued_date: optionalDate(d),
    expires_at: optionalDate(d),
    notes: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().max(2000, d.documents.actions.notesTooLong).nullable(),
    ),
  });

const createShareSchema = (d: Dictionary) =>
  z.object({
    document_id: z.string().uuid(d.documents.actions.chooseDocument),
    // A calendar day; the link expires at the end of that day (UTC).
    expires_date: dateOnly(d),
    max_views: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce
        .number()
        .int(d.documents.actions.viewsInteger)
        .positive(d.documents.actions.viewsPositive)
        .max(100_000, d.documents.actions.viewsTooLarge)
        .nullable(),
    ),
    recipient_label: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().max(120, d.documents.actions.labelTooLong).nullable(),
    ),
  });

/* ------------------------------------------------------------------ helpers --- */

/**
 * `documents.storage_path` is recorded WITH the bucket prefix (docs/06 §2.1),
 * while the storage SDK wants a key relative to the bucket. Mirror the Edge
 * Function's `objectKey()` so either shape resolves.
 */
function objectKey(storagePath: string): string {
  const trimmed = storagePath.replace(/^\/+/, "");
  return trimmed.startsWith(`${DOCUMENTS_BUCKET}/`)
    ? trimmed.slice(DOCUMENTS_BUCKET.length + 1)
    : trimmed;
}

/** Reduces a filename to a safe single path segment; preserves a readable name. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
}

/** Token hash — `SHA-256(pepper || token)`, lowercase hex. Matches share-view. */
function hashToken(token: string): string {
  return createHash("sha256").update(`${SHARE_TOKEN_PEPPER}${token}`).digest("hex");
}

/* ------------------------------------------------------------------ upload --- */

/**
 * Uploads one compliance document (SA/MGR only). Object bytes and the metadata
 * row are one logical operation (docs/06 §3.1): if the metadata insert fails, the
 * just-written object is removed so no orphan is left behind.
 *
 * Accepts `FormData` because the payload carries a file. The file is validated
 * app-layer (type/size/MIME allow-list) purely for UX — the private bucket's RLS
 * is the authority.
 */
/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
function dbMessages(d: Dictionary): SqlStateMessages {
  return { "23503": d.documents.actions.modelGone, "23505": d.documents.actions.documentExists, "23514": d.documents.actions.dbRule };
}

/* --------------------------------------------------- analyse before upload --- */

export type DraftAnalysis =
  | {
      ok: true;
      /** Whatever the AI could read. Fields it could not read are absent. */
      meta: { docType?: string; title?: string; issuedDate?: string; expiresAt?: string };
      summary: string;
      keyFigures: KeyFigure[];
    }
  | { ok: false; error: string; reason?: string };

/**
 * Read a just-picked file so the upload form can fill itself in.
 *
 * This runs BEFORE anything is stored: no `documents` row, no object in the
 * bucket. That is deliberate — a file the uploader is still deciding about
 * should not leave a trace, and analysing the bytes in hand avoids a
 * store-then-download round trip.
 *
 * Consent: the uploader ticks "read this file" in the dialog, and that tick is
 * what is passed to the compliance channel. It is the same per-file, per-person
 * decision the stored-document opt-in represents (docs/12 §6) — taken a moment
 * earlier, while they are looking at the file. Nothing is analysed without it.
 *
 * The result is a SUGGESTION. It is returned to the browser and shown in the
 * form; it is never written anywhere until the human submits.
 */
export async function analyseDraftDocument(formData: FormData): Promise<DraftAnalysis> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const locale = toLocale(profile.locale);
  const d = dict(locale);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: d.documents.actions.chooseFile };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: d.documents.actions.tooLarge(MAX_FILE_MB) };
  }
  const mime = file.type || "application/octet-stream";
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, error: d.documents.actions.badType };
  }

  if (!(await isAiConfigured())) {
    return { ok: false, error: d.aiRuntime.notConfigured, reason: "not_configured" };
  }

  // Metered and capped exactly like every other provider call. The service
  // client is required for the GLOBAL budget window, which spans users.
  let admin: AiSupabaseClient;
  try {
    ({ admin } = await guardedAdminClient(["super_admin", "manager"]));
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.actions.forbidden };
    throw error;
  }
  const budget = await checkBudget(user.id, admin, locale);
  if (!budget.ok) {
    return { ok: false, error: budget.reason ?? d.aiRuntime.budgetReached, reason: budget.status };
  }

  const started = Date.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await analyseDraft(bytes, mime, supabase, locale);

  if (result.status === "analysed") {
    await recordUsage(
      {
        userId: user.id,
        requestKind: "extract",
        provider: result.provider,
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        status: "ok",
        durationMs: Date.now() - started,
      },
      admin,
    );
    // A crossing happened, so it is audited — with the file's shape, never its
    // contents, and no document id because no document exists yet.
    await writeAudit({
      action: "ai.analyse",
      entityType: "document_draft",
      metadata: { mime_type: mime, size_bytes: file.size, provider: result.provider, model: result.model },
    });
    return {
      ok: true,
      meta: {
        docType: result.documentMeta.docType,
        title: result.documentMeta.title,
        issuedDate: result.documentMeta.issuedDate,
        expiresAt: result.documentMeta.expiresAt,
      },
      summary: result.summary,
      keyFigures: result.keyFigures,
    };
  }

  if (result.status === "skipped") {
    return { ok: false, error: d.documents.actions.analyseSkipped, reason: result.reason };
  }
  if (result.provider) {
    await recordUsage(
      {
        userId: user.id,
        requestKind: "extract",
        provider: result.provider,
        model: result.model ?? "unknown",
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        status: "error",
        durationMs: Date.now() - started,
      },
      admin,
    );
  }
  return { ok: false, error: d.documents.actions.analyseFailed, reason: result.reason };
}

export async function uploadDocument(formData: FormData): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = uploadMetaSchema(d).safeParse({
    model_id: formData.get("model_id"),
    doc_type: formData.get("doc_type"),
    title: formData.get("title"),
    issued_date: formData.get("issued_date"),
    expires_at: formData.get("expires_at"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.actions.checkForm) };
  }
  const meta = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: d.documents.actions.chooseFile };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: d.documents.actions.tooLarge(MAX_FILE_MB) };
  }
  const mime = file.type || "application/octet-stream";
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, error: d.documents.actions.badType };
  }

  try {
    const documentId = randomUUID();
    const safeName = sanitizeFilename(file.name);
    const key = `${meta.model_id}/${documentId}/${safeName}`;
    const storagePath = `${DOCUMENTS_BUCKET}/${key}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(key, bytes, { contentType: mime, upsert: false });

    if (uploadError) {
      return { ok: false, error: d.documents.actions.storeFailed };
    }

    const { data: created, error: insertError } = await supabase
      .from("documents")
      .insert({
        id: documentId,
        model_id: meta.model_id,
        doc_type: meta.doc_type,
        title: meta.title,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: mime,
        file_size_bytes: file.size,
        sha256,
        issued_date: meta.issued_date,
        expires_at: meta.expires_at,
        uploaded_by: user.id,
        notes: meta.notes,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      // Roll back the orphaned object — metadata is the system of record.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([key]);
      return { ok: false, error: describeDbError(insertError?.code, dbMessages(d), d.documents.actions.saveFailed) };
    }

    await writeAudit({
      action: "document.upload",
      entityType: "document",
      entityId: created.id,
      metadata: {
        model_id: meta.model_id,
        doc_type: meta.doc_type,
        file_name: file.name,
        mime_type: mime,
        file_size_bytes: file.size,
        sha256,
      },
    });

    revalidatePath("/documents");
    revalidatePath(`/models/${meta.model_id}`);
    return { ok: true, message: d.documents.actions.uploaded };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenUpload };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------------- download --- */

export type DownloadResult =
  | { ok: true; url: string; fileName: string }
  | { ok: false; error: string };

/**
 * Issues a 60-second signed URL for one document (docs/06 §3.2) and audits the
 * issuance. The URL is the tightest practical bound for a click-through download;
 * the browser must fetch the object before it expires.
 */
export async function getDownloadUrl(documentId: string): Promise<DownloadResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!z.string().uuid().safeParse(documentId).success) {
    return { ok: false, error: d.documents.actions.invalidDocument };
  }

  try {
    const { data: document, error } = await supabase
      .from("documents")
      .select("id, model_id, storage_path, file_name")
      .eq("id", documentId)
      .maybeSingle();

    if (error || !document) {
      return { ok: false, error: d.documents.actions.documentGone };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(objectKey(document.storage_path), 60, {
        download: document.file_name,
      });

    if (signError || !signed?.signedUrl) {
      return { ok: false, error: d.documents.actions.downloadFailed };
    }

    await writeAudit({
      action: "document.download",
      entityType: "document",
      entityId: document.id,
      metadata: { model_id: document.model_id, file_name: document.file_name },
    });

    return { ok: true, url: signed.signedUrl, fileName: document.file_name };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenDownload };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------- share: create --- */

export type CreateShareInput = {
  document_id: string;
  expires_date: string;
  max_views?: string | number | null;
  recipient_label?: string | null;
};

export type CreateShareResult =
  | { ok: true; url: string; prefix: string; message?: string }
  | { ok: false; error: string };

/**
 * Mints a single-document, time-boxed, optionally view-limited, revocable share
 * link (docs/06 §5.2). Returns the raw token URL ONCE — only its SHA-256 hash
 * and an 8-char prefix are stored, so a database dump yields no usable links.
 */
export async function createShare(input: CreateShareInput): Promise<CreateShareResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createShareSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.actions.checkForm) };
  }
  const data = parsed.data;

  // End-of-day (UTC) on the chosen calendar date; must be in the future.
  const expiresAt = `${data.expires_date}T23:59:59.999Z`;
  if (Date.parse(expiresAt) <= Date.now()) {
    return { ok: false, error: d.documents.actions.expiryInPast };
  }

  try {
    // Confirm the document is visible to this caller before minting a link for it.
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id")
      .eq("id", data.document_id)
      .maybeSingle();
    if (docError || !document) {
      return { ok: false, error: d.documents.actions.documentGone };
    }

    // 32 bytes CSPRNG → base64url (~43 chars, URL-safe, no padding). §5.1
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const tokenPrefix = token.slice(0, 8);

    const { data: created, error } = await supabase
      .from("document_shares")
      .insert({
        document_id: data.document_id,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        recipient_label: data.recipient_label,
        expires_at: expiresAt,
        max_views: data.max_views,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: d.documents.actions.shareCreateFailed };
    }

    await writeAudit({
      action: "share.create",
      entityType: "document_shares",
      entityId: created.id,
      metadata: {
        document_id: data.document_id,
        token_prefix: tokenPrefix,
        expires_at: expiresAt,
        max_views: data.max_views,
      },
    });

    revalidatePath("/documents");
    const url = `${appBaseUrl()}/share/${token}`;
    return {
      ok: true,
      url,
      prefix: tokenPrefix,
      message: d.documents.actions.shareShownOnce,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenShareCreate };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------- share: revoke --- */

/**
 * Revokes a share link (docs/06 §5.5). New views are blocked immediately; the
 * only residual exposure is a signed URL minted in the last ≤ 60 seconds, which
 * dies with its TTL.
 */
export async function revokeShare(input: { id: string }): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: d.documents.actions.invalidShare };
  }

  try {
    const { data: revoked, error } = await supabase
      .from("document_shares")
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq("id", input.id)
      .is("revoked_at", null)
      .select("id, document_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: d.documents.actions.shareRevokeFailed };
    }
    if (!revoked) {
      return { ok: false, error: d.documents.actions.shareAlreadyRevoked };
    }

    await writeAudit({
      action: "share.revoke",
      entityType: "document_shares",
      entityId: input.id,
      metadata: { document_id: revoked.document_id },
    });

    revalidatePath("/documents");
    return { ok: true, message: d.documents.actions.shareRevoked };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenShareRevoke };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* --------------------------------------------------- AI analysis opt-in (014) --- */

/**
 * Set (or clear) a compliance document's consent to AI analysis. This is the
 * ONLY writer of `documents.ai_analysis_opt_in`, and toggling it is itself an
 * audited governance event — the record of a deliberate decision to send (or
 * stop sending) a performer's identity document to a third-party AI processor.
 *
 * Turning it OFF also resets any prior analysis output so a revoked document
 * does not keep displaying provider-derived content.
 */
export async function setDocumentAnalysisOptIn(input: {
  document_id: string;
  opt_in: boolean;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));
  const parsed = z
    .object({ document_id: z.string().uuid(), opt_in: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: d.documents.actions.invalidRequest };

  try {
    const patch = parsed.data.opt_in
      ? { ai_analysis_opt_in: true }
      : {
          ai_analysis_opt_in: false,
          ai_status: "pending" as const,
          ai_summary: null,
          ai_key_figures: null,
          analysed_at: null,
          analysed_provider: null,
        };

    const { data: updated, error } = await supabase
      .from("documents")
      .update(patch)
      .eq("id", parsed.data.document_id)
      .select("id, model_id")
      .maybeSingle();
    if (error || !updated) {
      return { ok: false, error: d.documents.actions.optInUpdateFailed };
    }

    await writeAudit({
      action: parsed.data.opt_in ? "ai.analyse" : "ai.analyse",
      entityType: "document",
      entityId: parsed.data.document_id,
      metadata: {
        event: parsed.data.opt_in ? "opt_in" : "opt_out",
        model_id: updated.model_id,
      },
    });

    revalidatePath("/documents");
    return {
      ok: true,
      message: parsed.data.opt_in
        ? d.documents.actions.optInOn
        : d.documents.actions.optInOff,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenOptIn };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* --------------------------------------------------------------- share: list --- */

export type ShareListItem = {
  id: string;
  token_prefix: string;
  recipient_label: string | null;
  created_at: string;
  expires_at: string;
  max_views: number | null;
  view_count: number;
  last_viewed_at: string | null;
  revoked_at: string | null;
};

export type ListSharesResult =
  | { ok: true; shares: ShareListItem[] }
  | { ok: false; error: string };

/**
 * Lists the share links for one document, newest first. RLS scopes the result:
 * Super Admin sees every share; a manager sees the shares they created
 * (docs/04 §7.11). The token hash is never selected.
 */
export async function listShares(documentId: string): Promise<ListSharesResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!z.string().uuid().safeParse(documentId).success) {
    return { ok: false, error: d.documents.actions.invalidDocument };
  }

  try {
    const { data, error } = await supabase
      .from("document_shares")
      .select(
        "id, token_prefix, recipient_label, created_at, expires_at, max_views, view_count, last_viewed_at, revoked_at",
      )
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: d.documents.actions.sharesLoadFailed };
    }
    return { ok: true, shares: (data ?? []) as ShareListItem[] };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenSharesList };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------- share: view audit --- */

export type ShareViewItem = {
  id: number;
  viewed_at: string;
  user_agent: string | null;
  ip_hash: string | null;
};

export type ListShareViewsResult =
  | { ok: true; views: ShareViewItem[] }
  | { ok: false; error: string };

/**
 * Lists the anonymous view audit for one share (docs/06 §6). Each row is one
 * served view; IPs are only ever the salted hash the Edge Function stored, never
 * the raw address (docs/06 §5.6). RLS mirrors the share visibility above.
 */
export async function listShareViews(shareId: string): Promise<ListShareViewsResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!z.string().uuid().safeParse(shareId).success) {
    return { ok: false, error: d.documents.actions.invalidShare };
  }

  try {
    const { data, error } = await supabase
      .from("document_share_views")
      .select("id, viewed_at, user_agent, ip_hash")
      .eq("share_id", shareId)
      .order("viewed_at", { ascending: false })
      .limit(200);

    if (error) {
      return { ok: false, error: d.documents.actions.viewsLoadFailed };
    }
    return { ok: true, views: (data ?? []) as ShareViewItem[] };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.documents.actions.forbiddenViewsList };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
