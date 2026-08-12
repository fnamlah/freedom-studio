/**
 * Local content extraction for classification and analysis (docs/12 §4.1–4.2).
 *
 * SERVER-ONLY (uses `node:Buffer`, `unpdf`, `mammoth`, `exceljs`). Text is
 * capped at a leading excerpt — a category is decided by a document's first
 * page, not its last. Nothing here crosses a provider boundary; it only
 * prepares the payload the analysis channel will (or will not) let through.
 */

import { extractText, getDocumentProxy } from "unpdf";

/** Leading-excerpt cap for extracted text (docs/12 §4.2). */
export const MAX_EXTRACT_CHARS = 30_000;

/** Spreadsheets are flattened row-by-row; cap the rows so a 50k-row export
 * cannot blow the excerpt budget on a single sheet. */
const MAX_SHEET_ROWS = 400;

export type ExtractBranch = "image" | "text" | "unsupported";

const WORD_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

const SHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel.sheet.macroenabled.12", // .xlsm
  "application/vnd.oasis.opendocument.spreadsheet", // .ods (exceljs reads many)
]);

/**
 * Legacy binary Office formats. These are NOT the same file format as their
 * modern namesakes — `.doc` and `.xls` are OLE compound files that the modern
 * parsers cannot read. Recognised explicitly so the UI can say "convert this
 * to .docx/.xlsx" instead of the useless "unsupported type".
 */
const LEGACY_OFFICE_MIMES = new Set([
  "application/msword", // .doc
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-powerpoint", // .ppt
]);

export function isLegacyOfficeMime(mime: string | null | undefined): boolean {
  return LEGACY_OFFICE_MIMES.has((mime ?? "").toLowerCase());
}

/**
 * Which extraction branch a mime type takes (docs/12 §4.2):
 * `image/*` → vision; PDF, text/*, Word and spreadsheets → text; else unsupported.
 */
export function extractBranch(mime: string | null | undefined): ExtractBranch {
  if (!mime) return "unsupported";
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "text";
  if (m.startsWith("text/")) return "text";
  if (m === "application/json" || m === "application/csv") return "text";
  if (WORD_MIMES.has(m) || SHEET_MIMES.has(m)) return "text";
  return "unsupported";
}

export function truncateText(s: string, max = MAX_EXTRACT_CHARS): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Extract text from file bytes, by format:
 *   PDF          → `unpdf` text layer, pages merged
 *   .docx        → `mammoth` raw text
 *   .xlsx/.ods   → `exceljs`, flattened as `Sheet | a | b | c` rows
 *   text/csv/json→ UTF-8 passthrough
 *
 * The result is truncated to `MAX_EXTRACT_CHARS`. A PDF with no text layer
 * returns "" — the caller decides whether to route to vision or mark the file
 * `skipped`.
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

  if (WORD_MIMES.has(m)) {
    const { default: mammoth } = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return truncateText(value.trim());
  }

  if (SHEET_MIMES.has(m)) {
    return truncateText(await extractSheetText(bytes));
  }

  const decoded = new TextDecoder("utf-8").decode(bytes);
  return truncateText(decoded);
}

/**
 * Flatten a workbook to text a language model can read: one line per row,
 * cells pipe-separated, each sheet under its own heading. Formulas are read as
 * their cached result — the number on the page is what the document says.
 */
async function extractSheetText(bytes: Uint8Array): Promise<string> {
  // exceljs is CommonJS: under ESM the namespace object carries the real
  // exports on `.default`, so `new ns.Workbook()` throws.
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);

  const out: string[] = [];
  wb.eachSheet((sheet) => {
    out.push(`# Sheet: ${sheet.name}`);
    let rows = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows >= MAX_SHEET_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellToText(cell.value)));
      const line = cells.join(" | ").trim();
      if (line.replace(/\|/g, "").trim()) {
        out.push(line);
        rows += 1;
      }
    });
    if (rows >= MAX_SHEET_ROWS) out.push(`… (truncated at ${MAX_SHEET_ROWS} rows)`);
  });
  return out.join("\n").trim();
}

/** Render one ExcelJS cell value as plain text. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    // Formula cells carry {formula, result}; hyperlinks {text, hyperlink};
    // rich text {richText:[{text}]}. Prefer the displayed value in each case.
    if ("result" in v) return cellToText(v.result);
    if ("text" in v) return String(v.text);
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    return "";
  }
  return String(value);
}

/** Encode raw bytes as a `data:` URL for the OpenAI-compatible vision branch. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${base64}`;
}
