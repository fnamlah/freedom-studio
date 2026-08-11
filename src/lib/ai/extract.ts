/**
 * Local content extraction for classification (docs/12 §4.1–4.2).
 *
 * SERVER-ONLY (uses `node:Buffer` and `unpdf`). Text is capped at a leading
 * excerpt — a category is decided by a document's first page, not its last.
 * Nothing here crosses a provider boundary; it only prepares the payload the
 * `classificationChannel` will (or will not) let through.
 */

import { extractText, getDocumentProxy } from "unpdf";

/** Leading-excerpt cap for extracted text (docs/12 §4.2). */
export const MAX_EXTRACT_CHARS = 30_000;

export type ExtractBranch = "image" | "text" | "unsupported";

/**
 * Which extraction branch a mime type takes (docs/12 §4.2):
 * `image/*` → vision; `application/pdf` and `text/*` → text; else unsupported.
 */
export function extractBranch(mime: string | null | undefined): ExtractBranch {
  if (!mime) return "unsupported";
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "text";
  if (m.startsWith("text/")) return "text";
  if (m === "application/json" || m === "application/csv") return "text";
  return "unsupported";
}

export function truncateText(s: string, max = MAX_EXTRACT_CHARS): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Extract text from file bytes. PDFs go through `unpdf` (first-page-onward text
 * layer, merged); txt/md/csv/json are decoded as UTF-8 passthrough. The result
 * is truncated to `MAX_EXTRACT_CHARS`. A PDF with no text layer returns "" — the
 * caller decides whether to route to vision or mark the file `skipped`.
 */
export async function extractTextFromBytes(
  bytes: Uint8Array,
  mime: string | null | undefined,
): Promise<string> {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // `mergePages: true` returns a single merged string across all pages.
    const { text } = await extractText(pdf, { mergePages: true });
    return truncateText(text.trim());
  }
  const decoded = new TextDecoder("utf-8").decode(bytes);
  return truncateText(decoded);
}

/** Encode raw bytes as a `data:` URL for the OpenAI-compatible vision branch. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${base64}`;
}
