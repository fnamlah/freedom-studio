/**
 * Shared, CLIENT-SAFE constants and derivations for the Documents module.
 *
 * This file has no server-only imports, so it may be pulled into both the server
 * action / page and the `"use client"` components. It carries the document-type
 * vocabulary, the upload allow-list (an app-layer UX check — storage RLS remains
 * the authority, docs/06 §3.1), and the two derivations that are never stored:
 * compliance status (docs/06 §4) and share-link status (docs/06 §5.7).
 *
 * The enum VALUES here are the database's own and stay English; their LABELS
 * live in `d.documents.*` and are looked up by these helpers.
 */

import type { Database } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";

/* --------------------------------------------------------------- doc types --- */

export const DOCUMENT_TYPES = [
  "government_id",
  "passport",
  "contract",
  "model_release",
  "consent_form",
  "tax_form",
  "other",
] as const satisfies readonly Database["public"]["Enums"]["document_type"][];

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** `{ value, label }` pairs for the `Select` picker (assignable to SelectOption[]). */
export function documentTypeOptions(d: Dictionary): { value: DocumentType; label: string }[] {
  return DOCUMENT_TYPES.map((value) => ({ value, label: d.documents.docType[value] }));
}

export function documentTypeLabel(d: Dictionary, value: string | null | undefined): string {
  if (value && value in d.documents.docType) {
    return d.documents.docType[value as DocumentType];
  }
  return d.documents.docTypeFallback;
}

/* ------------------------------------------------------------- upload rules --- */

/**
 * MIME allow-list for compliance documents. The studio holds identity documents,
 * contracts and tax forms — scans and PDFs, never media (docs/01, docs/06 §1).
 * This is a UX guard only; the private bucket's RLS is the real boundary.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  // Office documents and spreadsheets (contracts, tax forms, statements).
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls (legacy BIFF — the studio holds many)
  "application/vnd.ms-excel.sheet.macroenabled.12", // .xlsm
  "application/vnd.ms-excel.sheet.binary.macroenabled.12", // .xlsb
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  "application/msword", // .doc (legacy binary Word)
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/csv",
  "application/csv",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMime(mime: string | null | undefined): mime is AllowedMimeType {
  return typeof mime === "string" && (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Human-friendly accept summary for the file picker and hint text lives in the
 * dictionary as `d.documents.allowedMimeLabel` — the extensions are universal
 * but the sentence around them is not.
 */

/** The `accept` attribute for the `<input type="file">`. */
export const FILE_ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",");

/** Largest accepted upload. Generous enough for a multi-page scanned contract. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_FILE_MB = 25;

/* ------------------------------------------------------ compliance derivation --- */

export type ComplianceStatus = "valid" | "expiring" | "expired";

/** Number of days before `expires_at` that a document is flagged as expiring. */
export const EXPIRING_WINDOW_DAYS = 30;

/**
 * Derives compliance status from `expires_at` — the exact rule the
 * `v_document_compliance` view implements (docs/06 §4, docs/07). Never stored:
 * there is no status column to drift and no batch job to forget.
 *
 *   expired  — expires_at < today
 *   expiring — expires_at within the next 30 days
 *   valid    — more than 30 days away, or no expiry (non-expiring documents)
 *
 * Date-only, UTC, to match the app's UTC formatting and avoid hydration drift.
 */
export function deriveComplianceStatus(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): ComplianceStatus {
  if (!expiresAt) return "valid";
  const expDay = expiresAt.slice(0, 10);
  const exp = Date.parse(`${expDay}T00:00:00Z`);
  if (Number.isNaN(exp)) return "valid";

  const todayDay = now.toISOString().slice(0, 10);
  const today = Date.parse(`${todayDay}T00:00:00Z`);
  if (exp < today) return "expired";
  if (exp <= today + EXPIRING_WINDOW_DAYS * 86_400_000) return "expiring";
  return "valid";
}

/** Badge colour per compliance state; the labels are `d.documents.compliance`. */
export const COMPLIANCE_META: Record<
  ComplianceStatus,
  { variant: "success" | "warning" | "danger" }
> = {
  valid: { variant: "success" },
  expiring: { variant: "warning" },
  expired: { variant: "danger" },
};

/* ----------------------------------------------------------- share status --- */

export type ShareStatus = "active" | "expired" | "exhausted" | "revoked";

export type ShareStatusInput = {
  revoked_at: string | null;
  expires_at: string;
  max_views: number | null;
  view_count: number;
};

/**
 * Derives a share link's lifecycle state (docs/06 §5.7). All non-active states
 * are terminal — extending access always means minting a new token.
 */
export function deriveShareStatus(
  share: ShareStatusInput,
  now: Date = new Date(),
): ShareStatus {
  if (share.revoked_at) return "revoked";
  if (Date.parse(share.expires_at) <= now.getTime()) return "expired";
  if (share.max_views !== null && share.view_count >= share.max_views) return "exhausted";
  return "active";
}

/** Badge colour per share state; the labels are `d.documents.shareStatus`. */
export const SHARE_STATUS_META: Record<
  ShareStatus,
  { variant: "success" | "muted" | "warning" | "danger" }
> = {
  active: { variant: "success" },
  expired: { variant: "muted" },
  exhausted: { variant: "warning" },
  revoked: { variant: "danger" },
};
