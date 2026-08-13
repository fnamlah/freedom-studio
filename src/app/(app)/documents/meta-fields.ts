import { z } from "zod";

import { isValidYmd } from "@/lib/forms";
import type { Dictionary } from "@/lib/i18n";

import { DOCUMENT_TYPES } from "./doc-meta";

/**
 * The document-metadata validation vocabulary, shared by BOTH write paths: the
 * upload action and the inbox's `document_meta` apply (021). Same reasoning as
 * `earnings/earning-fields.ts` — a `"use server"` file cannot export a schema,
 * and an AI-proposed value must pass exactly the validation a typed one does.
 *
 * NOT in `doc-meta.ts`: that module is deliberately client-safe and zod-free,
 * and these factories are only ever built inside server actions.
 */

export const docDateOnly = (d: Dictionary) =>
  z.string().refine(isValidYmd, d.documents.actions.invalidDate);

const optionalDate = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    docDateOnly(d).nullable(),
  );

/** The four fields a document says about itself. */
export const documentMetaFields = (d: Dictionary) => ({
  doc_type: z.enum(DOCUMENT_TYPES),
  title: z
    .string()
    .trim()
    .min(1, d.documents.actions.titleRequired)
    .max(200, d.documents.actions.titleTooLong),
  issued_date: optionalDate(d),
  expires_at: optionalDate(d),
});
