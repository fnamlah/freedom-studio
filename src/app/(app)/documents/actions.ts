"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { appBaseUrl, optionalEnv } from "@/lib/env";
import { isAuthzError } from "@/lib/supabase/admin";

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

const dateOnly = z.string().refine(isValidYmd, "Enter a valid date (YYYY-MM-DD).");
const optionalDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  dateOnly.nullable(),
);

const uploadMetaSchema = z.object({
  model_id: z.string().uuid("Choose a model."),
  doc_type: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().min(1, "Give the document a title.").max(200, "Title is too long."),
  issued_date: optionalDate,
  expires_at: optionalDate,
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(2000, "Notes are too long.").nullable(),
  ),
});

const createShareSchema = z.object({
  document_id: z.string().uuid("Choose a document."),
  // A calendar day; the link expires at the end of that day (UTC).
  expires_date: dateOnly,
  max_views: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce
      .number()
      .int("Whole number of views.")
      .positive("Must be at least 1.")
      .max(100_000, "That view cap is too large.")
      .nullable(),
  ),
  recipient_label: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(120, "Label is too long.").nullable(),
  ),
});

/* ------------------------------------------------------------------ helpers --- */

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

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

function describeDbError(code: string | undefined): string {
  if (code === "23503") {
    return "That model no longer exists. Refresh and try again.";
  }
  if (code === "23505") {
    return "That document already exists. Refresh and try again.";
  }
  if (code === "23514") {
    return "That doesn't satisfy a database rule. Check the file and try again.";
  }
  return "Could not save the document. Please try again.";
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
export async function uploadDocument(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = uploadMetaSchema.safeParse({
    model_id: formData.get("model_id"),
    doc_type: formData.get("doc_type"),
    title: formData.get("title"),
    issued_date: formData.get("issued_date"),
    expires_at: formData.get("expires_at"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const meta = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `That file is too large. The limit is ${MAX_FILE_MB} MB.` };
  }
  const mime = file.type || "application/octet-stream";
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return {
      ok: false,
      error: "That file type isn't allowed. Upload a PDF, JPEG, PNG, WebP, HEIC or TIFF.",
    };
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
      return { ok: false, error: "Could not store the file. Please try again." };
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
      return { ok: false, error: describeDbError(insertError?.code) };
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
    return { ok: true, message: "Document uploaded." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to upload documents." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase } = await requireRole("super_admin", "manager");

  if (!z.string().uuid().safeParse(documentId).success) {
    return { ok: false, error: "Invalid document." };
  }

  try {
    const { data: document, error } = await supabase
      .from("documents")
      .select("id, model_id, storage_path, file_name")
      .eq("id", documentId)
      .maybeSingle();

    if (error || !document) {
      return { ok: false, error: "That document no longer exists." };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(objectKey(document.storage_path), 60, {
        download: document.file_name,
      });

    if (signError || !signed?.signedUrl) {
      return { ok: false, error: "Could not prepare the download. Please try again." };
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
      return { ok: false, error: "You are not authorized to download documents." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = createShareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  // End-of-day (UTC) on the chosen calendar date; must be in the future.
  const expiresAt = `${data.expires_date}T23:59:59.999Z`;
  if (Date.parse(expiresAt) <= Date.now()) {
    return { ok: false, error: "Pick an expiry date in the future." };
  }

  try {
    // Confirm the document is visible to this caller before minting a link for it.
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id")
      .eq("id", data.document_id)
      .maybeSingle();
    if (docError || !document) {
      return { ok: false, error: "That document no longer exists." };
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
      return { ok: false, error: "Could not create the share link. Please try again." };
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
      message: "Copy this link now — it is shown only once.",
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to create share links." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------- share: revoke --- */

/**
 * Revokes a share link (docs/06 §5.5). New views are blocked immediately; the
 * only residual exposure is a signed URL minted in the last ≤ 60 seconds, which
 * dies with its TTL.
 */
export async function revokeShare(input: { id: string }): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: "Invalid share link." };
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
      return { ok: false, error: "Could not revoke the share link. Please try again." };
    }
    if (!revoked) {
      return { ok: false, error: "That link is already revoked or no longer exists." };
    }

    await writeAudit({
      action: "share.revoke",
      entityType: "document_shares",
      entityId: input.id,
      metadata: { document_id: revoked.document_id },
    });

    revalidatePath("/documents");
    return { ok: true, message: "Share link revoked. Access ends within one minute." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to revoke share links." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase } = await requireRole("super_admin", "manager");
  const parsed = z
    .object({ document_id: z.string().uuid(), opt_in: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

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
      return { ok: false, error: "Could not update this document. Please try again." };
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
        ? "AI analysis enabled for this document."
        : "AI analysis disabled and prior analysis cleared.",
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to change this setting." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase } = await requireRole("super_admin", "manager");

  if (!z.string().uuid().safeParse(documentId).success) {
    return { ok: false, error: "Invalid document." };
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
      return { ok: false, error: "Could not load share links. Please try again." };
    }
    return { ok: true, shares: (data ?? []) as ShareListItem[] };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to view share links." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase } = await requireRole("super_admin", "manager");

  if (!z.string().uuid().safeParse(shareId).success) {
    return { ok: false, error: "Invalid share link." };
  }

  try {
    const { data, error } = await supabase
      .from("document_share_views")
      .select("id, viewed_at, user_agent, ip_hash")
      .eq("share_id", shareId)
      .order("viewed_at", { ascending: false })
      .limit(200);

    if (error) {
      return { ok: false, error: "Could not load the view audit. Please try again." };
    }
    return { ok: true, views: (data ?? []) as ShareViewItem[] };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to view the share audit." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
