"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  normalizeFolderPath,
  type AiReviewStatus,
} from "@/components/library/library-meta";

/**
 * File Library server actions — Super Admin + Manager only (docs/12 §1, §2.4:
 * `library_files` is full CRUD for SA/MGR; models, finance and operators have no
 * policy on the table at all, so it is invisible to them).
 *
 * Everything the browser can trigger passes through one of these actions. Each
 * opens with `requireRole("super_admin", "manager")`, which redirects an
 * unauthorized caller before any work runs, then works through the caller's own
 * RLS-scoped client — SA/MGR hold read+write on both the private `library`
 * bucket (docs/12 §2.5) and `library_files`, so RLS stays the final authority.
 *
 * The object key is FLAT — `{file_id}/{filename}` — and stored verbatim in
 * `storage_path` (docs/12 §1, §2.2). It never encodes `folder_path`; re-filing a
 * document is a metadata UPDATE, never a byte move. Downloads are a 60-second
 * signed URL (docs/12 §2.5); there is no public URL and no share-link path.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const LIBRARY_BUCKET = "library";

/* -------------------------------------------------------------- validation --- */

const uuid = z.string().uuid();

/**
 * The schemas are FACTORIES rather than module constants: a `z.object(...)`
 * evaluated at import time is built long before any request exists, so it cannot
 * know the caller's language. Building it inside the action — once the auth
 * context has handed us `profile.locale` — is what lets a validation message
 * come back in Russian.
 */
const uploadMetaSchema = (d: Dictionary) =>
  z.object({
    folder_path: z.string().max(400, d.library.actions.folderTooLong),
    name: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(200, d.library.actions.nameTooLong).nullable(),
    ),
    category_id: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      uuid.nullable(),
    ),
    ai_exempt: z.preprocess(
      (v) => v === true || v === "true" || v === "on" || v === "1",
      z.boolean(),
    ),
  });

const categorizeSchema = () =>
  z.object({
    file_id: uuid,
    decision: z.enum(["confirm", "override"]),
    // Absent (confirm sends no category) and blank both normalize to null —
    // `nullable()` alone rejected `undefined`, which broke every confirm.
    category_id: z.preprocess(
      (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
      uuid.nullable(),
    ),
  });

/* ------------------------------------------------------------------ helpers --- */

function firstIssue(error: z.ZodError, d: Dictionary): string {
  return error.issues[0]?.message ?? d.library.actions.checkForm;
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

function describeDbError(code: string | undefined, d: Dictionary): string {
  if (code === "23503") {
    return d.library.actions.categoryGone;
  }
  if (code === "23505") {
    return d.library.actions.fileExists;
  }
  if (code === "23514") {
    return d.library.actions.dbRule;
  }
  return d.library.actions.saveFailed;
}

/* ------------------------------------------------------------------ upload --- */

/**
 * Uploads one Library file (SA/MGR only, docs/12 §4.1). The object bytes and the
 * metadata row are one logical operation: if the metadata insert fails, the
 * just-written object is removed so no orphan is left behind.
 *
 * The initial `ai_status` follows the decision node of docs/12 §4.1:
 *   - `ai_exempt` set at upload            → `skipped` (nothing ever crosses)
 *   - manual category with `ai_enabled=false` → `skipped`
 *   - otherwise                            → `pending` (the batch loop's queue)
 *
 * A pending file will TRANSIT the provider once when classified — the honest
 * limitation of docs/12 §6, surfaced to the uploader by the exemption notice.
 */
export async function uploadLibraryFile(formData: FormData): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = uploadMetaSchema(d).safeParse({
    folder_path: formData.get("folder_path"),
    name: formData.get("name"),
    category_id: formData.get("category_id"),
    ai_exempt: formData.get("ai_exempt"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const meta = parsed.data;
  const folderPath = normalizeFolderPath(meta.folder_path);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: d.library.actions.chooseFile };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: d.library.actions.tooLarge(MAX_UPLOAD_MB) };
  }

  const mime = file.type || "application/octet-stream";

  try {
    // A manual filing under an AI-disabled category means the classifier is
    // never told about the file (docs/12 §4.1) — it is filed by hand, skipped.
    let aiStatus: AiReviewStatus = meta.ai_exempt ? "skipped" : "pending";
    if (!meta.ai_exempt && meta.category_id) {
      const { data: category } = await supabase
        .from("doc_categories")
        .select("ai_enabled")
        .eq("id", meta.category_id)
        .maybeSingle();
      if (category && category.ai_enabled === false) {
        aiStatus = "skipped";
      }
    }

    const fileId = randomUUID();
    const safeName = sanitizeFilename(file.name);
    const storagePath = `${fileId}/${safeName}`; // flat key, docs/12 §2.2

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const { error: uploadError } = await supabase.storage
      .from(LIBRARY_BUCKET)
      .upload(storagePath, bytes, { contentType: mime, upsert: false });

    if (uploadError) {
      return { ok: false, error: d.library.actions.storeFailed };
    }

    const displayName = meta.name ?? file.name;

    const { data: created, error: insertError } = await supabase
      .from("library_files")
      .insert({
        id: fileId,
        folder_path: folderPath,
        name: displayName,
        mime_type: mime,
        size_bytes: file.size,
        storage_path: storagePath,
        sha256,
        category_id: meta.category_id,
        ai_status: aiStatus,
        ai_exempt: meta.ai_exempt,
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      // Roll back the orphaned object — metadata is the system of record.
      await supabase.storage.from(LIBRARY_BUCKET).remove([storagePath]);
      return { ok: false, error: describeDbError(insertError?.code, d) };
    }

    // docs/12 §3: record the exemption status AT UPLOAD, provably after the fact.
    await writeAudit({
      action: "library.upload",
      entityType: "library_file",
      entityId: created.id,
      metadata: {
        folder_path: folderPath,
        mime_type: mime,
        size_bytes: file.size,
        ai_exempt: meta.ai_exempt,
        ai_status: aiStatus,
        category_id: meta.category_id,
      },
    });

    revalidatePath("/library");
    return {
      ok: true,
      message: meta.ai_exempt
        ? d.library.actions.uploadedExempt
        : aiStatus === "skipped"
          ? d.library.actions.uploadedFiled
          : d.library.actions.uploadedPending,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.actions.forbiddenUpload };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* -------------------------------------------------------------- categorize --- */

/**
 * Applies a human filing decision (docs/12 §4.3) — the ONLY thing that moves the
 * authoritative `category_id`. `confirm` accepts the AI's suggestion; `override`
 * files under a different category. The two land as distinct `ai_status` values
 * on purpose: the confirmed/overridden ratio is the honest measure of whether
 * the vocabulary is any good. Audited `library.categorize`.
 */
export async function categorizeLibraryFile(input: {
  file_id: string;
  decision: "confirm" | "override";
  category_id?: string | null;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = categorizeSchema().safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const { file_id, decision, category_id } = parsed.data;

  try {
    const { data: file, error: loadError } = await supabase
      .from("library_files")
      .select("id, ai_status, ai_suggested_category_id, category_id")
      .eq("id", file_id)
      .maybeSingle();

    if (loadError || !file) {
      return { ok: false, error: d.library.actions.fileGone };
    }

    let newCategoryId: string;
    let newStatus: AiReviewStatus;

    if (decision === "confirm") {
      if (!file.ai_suggested_category_id) {
        return { ok: false, error: d.library.actions.noSuggestion };
      }
      newCategoryId = file.ai_suggested_category_id;
      newStatus = "confirmed";
    } else {
      if (!category_id) {
        return { ok: false, error: d.library.actions.chooseCategory };
      }
      const { data: category } = await supabase
        .from("doc_categories")
        .select("id")
        .eq("id", category_id)
        .maybeSingle();
      if (!category) {
        return { ok: false, error: d.library.actions.categoryGoneShort };
      }
      newCategoryId = category_id;
      newStatus = "overridden";
    }

    const { data: updated, error: updateError } = await supabase
      .from("library_files")
      .update({ category_id: newCategoryId, ai_status: newStatus })
      .eq("id", file_id)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      return { ok: false, error: d.library.actions.fileFailed };
    }

    await writeAudit({
      action: "library.categorize",
      entityType: "library_file",
      entityId: file_id,
      metadata: {
        decision,
        category_id: newCategoryId,
        suggested_category_id: file.ai_suggested_category_id,
        previous_status: file.ai_status,
      },
    });

    revalidatePath("/library");
    return {
      ok: true,
      message:
        decision === "confirm"
          ? d.library.actions.confirmed
          : d.library.actions.overridden,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.actions.forbiddenFile };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------------- download --- */

export type DownloadResult =
  | { ok: true; url: string; fileName: string }
  | { ok: false; error: string };

/**
 * Issues a 60-second signed URL for one Library file (docs/12 §2.5) and audits
 * the issuance as `library.download`. The `storage_path` never reaches the
 * browser — downloads go through this action by file id.
 */
export async function getLibraryDownloadUrl(fileId: string): Promise<DownloadResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!uuid.safeParse(fileId).success) {
    return { ok: false, error: d.library.actions.invalidFile };
  }

  try {
    const { data: file, error } = await supabase
      .from("library_files")
      .select("id, storage_path, name")
      .eq("id", fileId)
      .maybeSingle();

    if (error || !file) {
      return { ok: false, error: d.library.actions.fileGone };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(LIBRARY_BUCKET)
      .createSignedUrl(file.storage_path, 60, { download: file.name });

    if (signError || !signed?.signedUrl) {
      return { ok: false, error: d.library.actions.downloadFailed };
    }

    await writeAudit({
      action: "library.download",
      entityType: "library_file",
      entityId: file.id,
      metadata: { name: file.name },
    });

    return { ok: true, url: signed.signedUrl, fileName: file.name };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.actions.forbiddenDownload };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ delete --- */

/**
 * Removes a Library file (SA/MGR, docs/12 §2.4). The metadata row is the system
 * of record, so it is deleted first; the object is then removed best-effort. A
 * failed object removal leaves a harmless orphan rather than a dangling row.
 * Audited `library.delete`.
 */
export async function deleteLibraryFile(fileId: string): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  if (!uuid.safeParse(fileId).success) {
    return { ok: false, error: d.library.actions.invalidFile };
  }

  try {
    const { data: file, error: loadError } = await supabase
      .from("library_files")
      .select("id, storage_path, name")
      .eq("id", fileId)
      .maybeSingle();

    if (loadError || !file) {
      return { ok: false, error: d.library.actions.fileGone };
    }

    const { error: deleteError } = await supabase
      .from("library_files")
      .delete()
      .eq("id", fileId);

    if (deleteError) {
      return { ok: false, error: d.library.actions.deleteFailed };
    }

    await supabase.storage.from(LIBRARY_BUCKET).remove([file.storage_path]);

    await writeAudit({
      action: "library.delete",
      entityType: "library_file",
      entityId: fileId,
      metadata: { name: file.name },
    });

    revalidatePath("/library");
    return { ok: true, message: d.library.actions.deleted };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.actions.forbiddenDelete };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
