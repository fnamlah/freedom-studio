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

/**
 * Spreadsheet formats, ALL parsed by SheetJS — including the legacy BIFF
 * `.xls`, which is an OLE compound file and a genuinely different format from
 * the OOXML `.xlsx`. The studio holds many legacy `.xls` files, so this is a
 * first-class input, not a fallback.
 *
 * SheetJS is installed from the vendor's own CDN rather than the npm registry:
 * the registry copy is deprecated and carries known CVEs.
 */
const SHEET_MIMES = new Set([
  "application/vnd.ms-excel", // .xls (legacy BIFF)
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel.sheet.macroenabled.12", // .xlsm
  "application/vnd.ms-excel.sheet.binary.macroenabled.12", // .xlsb
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
]);

/**
 * Legacy binary formats we still cannot read. `.doc` and `.ppt` are OLE
 * compound files that the modern parsers do not handle; recognised explicitly
 * so the UI can say "convert this to .docx" instead of a bare "unsupported
 * type". Legacy `.xls` is NOT in this list — SheetJS reads it.
 */
const LEGACY_OFFICE_MIMES = new Set([
  "application/msword", // .doc
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
  // SheetJS is CommonJS: under ESM the real exports sit on `.default`.
  const mod = await import("xlsx");
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;

  // `cellDates` renders date cells as Dates rather than serial numbers, so the
  // model sees "2026-07-31" instead of "46234". Formula cells read as their
  // cached result — the number on the page is what the document says.
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });

  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    out.push(`# Sheet: ${name}`);
    // sheet_to_json (header:1) rather than sheet_to_csv: CSV would wrap every
    // value containing a space in quotes, which is pure noise once the
    // separator is " | ".
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      raw: false,
      dateNF: "yyyy-mm-dd",
      defval: "",
    });
    let emitted = 0;
    for (const row of grid) {
      if (emitted >= MAX_SHEET_ROWS) break;
      const line = row.map((c) => (c == null ? "" : String(c).trim())).join(" | ").trim();
      if (line.replace(/[|\s]/g, "").length === 0) continue;
      out.push(line);
      emitted += 1;
    }
    if (grid.length > emitted) {
      out.push(`… (truncated at ${emitted} of ${grid.length} rows)`);
    }
  }
  return out.join("\n").trim();
}

/** Encode raw bytes as a `data:` URL for the OpenAI-compatible vision branch. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${base64}`;
}
