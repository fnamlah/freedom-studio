import { z } from "zod";

import { emptyToNull, isValidYmd } from "../forms.js";

/**
 * Document upload rules, shared by the portal's upload form and the Telegram
 * bot's attachment path. Same contract as the other fields modules: relative
 * imports with runtime extensions so the worker's Node ESM build can load it,
 * and messages as a parameter so no dictionary import is needed.
 *
 * The mime allow-list and size cap moved HERE from `doc-meta.ts` (which now
 * re-exports them) the day the bot learned to accept Telegram attachments —
 * two copies of an upload allow-list is how one surface quietly starts
 * accepting what the other refuses.
 */

export const DOCUMENT_TYPES = [
  "government_id",
  "passport",
  "contract",
  "model_release",
  "consent_form",
  "tax_form",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** App-layer UX check — storage RLS remains the authority (docs/06 §3.1). */
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

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_FILE_MB = 25;

/**
 * Telegram's Bot API refuses `getFile` above 20 MB, so an attachment the
 * PORTAL would take at 25 can still be impossible for the BOT to fetch. The
 * bot checks against the smaller bound and says so, instead of proposing an
 * upload its executor can never download.
 */
export const TELEGRAM_MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface DocumentMetaMessages {
  titleRequired: string;
  dateInvalid: string;
}

export const DOCUMENT_META_MESSAGES_EN: DocumentMetaMessages = {
  titleRequired: "Give the document a title.",
  dateInvalid: "Enter a real date as YYYY-MM-DD.",
};

/** The metadata half of an upload; the file half is checked separately. */
export const documentMetaFields = (m: DocumentMetaMessages) => ({
  title: z.string().trim().min(1, m.titleRequired).max(200),
  doc_type: z.enum(DOCUMENT_TYPES).default("other"),
  issued_date: z
    .preprocess(emptyToNull, z.string().refine(isValidYmd, m.dateInvalid).nullable())
    .optional(),
  expires_at: z
    .preprocess(emptyToNull, z.string().refine(isValidYmd, m.dateInvalid).nullable())
    .optional(),
});

/** Reduces a filename to a safe single path segment; preserves a readable name.
 * Byte-for-byte the portal's sanitizer — the bot must never mint a storage key
 * shape the portal wouldn't. */
export function sanitizeFilename(name: string): string {
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
