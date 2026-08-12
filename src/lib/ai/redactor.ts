/**
 * THE outbound redaction chokepoint (docs/11 §5).
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ SECURITY-CRITICAL. Every provider-bound payload — tool results, user    │
 * │ text, embedding inputs — passes through this module, and there is no     │
 * │ second serialization path to an adapter. Per docs/11 §5 (mirroring the   │
 * │ posture docs/08 takes for security headers), ANY change here is a        │
 * │ security-reviewed design change, not a routine edit.                     │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Three mechanisms, strongest first:
 *   1. Per-tool allowlist projection (authoritative for structured data) — only
 *      the fields named in `PROJECTIONS[tool]` are ever serialized; everything
 *      else is dropped. Fail-closed: an unregistered tool throws.
 *   2. Global 17-key blocklist (backstop) — stripped wherever it appears in any
 *      provider-bound structure, independent of the projection.
 *   3. Free-text pattern scrubbing (best-effort defense-in-depth) — emails,
 *      phone numbers, card/IBAN-like strings masked in free text before egress.
 *
 * The single documented exception is `classificationChannel` (docs/12 §6), the
 * ONLY path on which a file's own contents may cross to a provider. It is kept
 * deliberately separate and heavily commented below.
 */

/* ------------------------------------------------------------ 1. blocklist */

/**
 * The canonical 17-key blocklist (docs/11 §5, mechanism 2). Stripped from any
 * provider-bound object, even if a projection named the key.
 *
 * `notes` is blocked on every path EXCEPT the embedding pipeline, which scrubs
 * note text (mechanism 3) and embeds the scrubbed form (docs/11 §6) — that path
 * never routes note bodies through `redactToolResult`, so blocking it here is
 * correct for the tool/chat surface.
 */
export const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  "legal_name",
  "full_name",
  "date_of_birth",
  "email",
  "phone",
  "payment_details",
  "payment_method",
  "reference",
  "ip",
  "ip_hash",
  "user_agent",
  "storage_path",
  "file_name",
  "sha256",
  "token_hash",
  "token_prefix",
  "notes",
]);

/* --------------------------------------------------------- 3. free-text scrub */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
// 13–19 digit runs allowing spaces/hyphens — card-number-shaped strings.
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
// Long phone-shaped runs (>=10 digit units with optional separators / leading +).
const PHONE_RE = /(?:\+?\d[\s().-]?){9,}\d/g;

/**
 * Best-effort pattern scrubbing of free text (docs/11 §5, mechanism 3). NOT the
 * boundary — free text can encode PII no pattern catches — which is exactly why
 * mechanisms 1 and 2 carry the policy. Card/IBAN are masked before the phone
 * pattern so a card number is not partially eaten as a phone run.
 */
export function scrubText(input: string): string {
  if (!input) return input;
  return input
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(IBAN_RE, "[redacted-iban]")
    .replace(CARD_RE, "[redacted-number]")
    .replace(PHONE_RE, "[redacted-number]");
}

/* ------------------------------------------------ 1. per-tool projections */

/**
 * The allowlist projection for each of the 12 registry tools (docs/11 §4, the
 * "Result projection sent to model" column). Keyed by tool name; the value is
 * the exact set of fields that may be serialized toward the provider. The
 * registry's `execute` resolves ids→names BEFORE this projection runs, so no
 * UUID is ever named here and none survives projection.
 */
export const PROJECTIONS: Record<string, readonly string[]> = {
  earnings_summary: ["group_key", "gross_amount", "net_amount"],
  earnings_monthly: ["month", "stage_name", "platform", "gross_amount", "net_amount"],
  hours_summary: ["stage_name", "hours", "session_count"],
  payout_summary: ["status", "payout_count", "total_net"],
  payout_history: [
    "payee_name",
    "period_start",
    "period_end",
    "net_amount",
    "currency",
    "status",
    "paid_at",
  ],
  payee_balances: ["payee_type", "display_name", "currency", "balance"],
  payee_statement: [
    "line_type",
    "entry_type",
    "amount",
    "currency",
    "entry_date",
    "running_balance",
    "description",
  ],
  split_distribution: ["month", "bucket", "amount", "share_percent"],
  forecast: ["target_month", "stage_name", "platform", "predicted_net"],
  forecast_accuracy: [
    "target_month",
    "stage_name",
    "predicted_net",
    "actual_net",
    "error_percent",
    "rolling_mape",
  ],
  compliance_summary: ["stage_name", "valid_count", "expiring_count", "expired_count"],
  semantic_search: ["source_type", "subject_name", "snippet", "similarity"],
  // `name` here is the Library DISPLAY name — a business artifact (training
  // guides, scripts) in a senior-staff-only subsystem whose content already
  // crosses via classificationChannel. The blocked key `file_name` (compliance
  // documents, which can carry identity in a filename) is deliberately NOT
  // relaxed: it still strips everywhere, including from these rows.
  library_search: [
    "name",
    "folder",
    "category",
    "suggested_category",
    "status",
    "summary",
    "key_figures",
    "uploaded_on",
  ],
};

/** The 13 canonical tool names that have a registered projection. */
export const PROJECTED_TOOLS = Object.keys(PROJECTIONS);

/** Raised when redaction cannot proceed safely — the caller must NOT send. */
export class RedactionError extends Error {
  readonly code = "redaction_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "RedactionError";
    Object.setPrototypeOf(this, RedactionError.prototype);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively strip blocklisted keys and scrub string leaves. */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(k)) continue;
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value; // number | boolean | null | undefined
}

function projectRow(row: unknown, allow: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(row)) return {};
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    if (BLOCKED_KEYS.has(key)) continue; // never emit a blocked key, even if listed
    if (!(key in row)) continue;
    out[key] = sanitizeValue(row[key]);
  }
  return out;
}

/**
 * Project raw tool-result rows down to the allowlist for `toolName`, apply the
 * blocklist backstop, and scrub free text. This is the boundary for structured
 * data leaving toward a provider.
 *
 * @throws {RedactionError} if the tool has no registered projection (fail-closed).
 */
export function redactToolResult(
  toolName: string,
  rows: unknown,
): Record<string, unknown>[] {
  const allow = PROJECTIONS[toolName];
  if (!allow) {
    throw new RedactionError(
      `No egress projection registered for tool "${toolName}" — refusing to serialize.`,
    );
  }
  const arr = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
  return arr.map((row) => projectRow(row, allow));
}

/* ------------------------------------------- THE classification carve-out */

export type ClassificationContent =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string; mimeType: string };

/** Raised when the classification channel refuses a crossing (exempt/disabled). */
export class RedactionRefusedError extends Error {
  readonly code = "redaction_refused" as const;
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? `Classification refused: ${reason}`);
    this.name = "RedactionRefusedError";
    this.reason = reason;
    Object.setPrototypeOf(this, RedactionRefusedError.prototype);
  }
}

export interface ClassificationChannelInput {
  /** `library_files.ai_exempt` — a per-file opt-out that blocks any crossing. */
  aiExempt: boolean;
  /**
   * `doc_categories.ai_enabled` of the file's CURRENT category, when it already
   * has one. `false` refuses the crossing (e.g. a file pre-filed as `identity`).
   * `undefined`/`null` = no assigned category yet, which does not block.
   */
  categoryAiEnabled?: boolean | null;
  /** The extracted content that must cross — text excerpt or image data URL. */
  content: ClassificationContent;
}

/**
 * ⚠ THE single owner-approved exception to the aggregates-only egress policy
 * (docs/12 §6). This is the ONLY path on which a file's own contents may cross
 * to a provider. Every clause below is a control, not a convenience:
 *
 *  • Scope is the `library` bucket only — the caller (`classifyFile`) only ever
 *    hands this a `library_files`-derived payload; compliance documents in
 *    `model-documents` have no code path to here.
 *  • Two independent opt-outs: per-file `ai_exempt`, per-category `ai_enabled`.
 *    Either one refuses the crossing (`RedactionRefusedError` → `ai_status`
 *    `skipped`).
 *  • Only the file, never its neighbours: this function accepts ONLY the
 *    extracted `content`. It is structurally impossible to pass `storage_path`,
 *    `sha256`, uploader identity or folder structure through it — the global
 *    blocklist (docs/11 §5) still governs everything except the extracted
 *    content itself, which crosses verbatim because classification requires it.
 *
 * Auditing (`ai.classify`) and metering (`ai_usage`) of each crossing are the
 * caller's responsibility (the classify route), per docs/12 §6 clauses 4–5.
 */
export function classificationChannel(
  input: ClassificationChannelInput,
): ClassificationContent {
  if (input.aiExempt) {
    throw new RedactionRefusedError("ai_exempt");
  }
  if (input.categoryAiEnabled === false) {
    throw new RedactionRefusedError("category_ai_disabled");
  }
  // The extracted content crosses verbatim — there is no design in which a
  // classifier reads a document without reading the document (docs/12 §6). No
  // metadata is accepted here, so nothing else can ride along.
  return input.content;
}

/* ---------------------------------- THE compliance-analysis carve-out (014) */

export interface ComplianceAnalysisChannelInput {
  /**
   * `documents.ai_analysis_opt_in`, read at CROSSING time. The record of a
   * deliberate per-document consent decision — never assumed, never defaulted
   * on; revoking it blocks the very next crossing.
   */
  aiAnalysisOptIn: boolean;
  /** The extracted content that must cross — text excerpt or image data URL. */
  content: ClassificationContent;
}

/**
 * ⚠ Owner-approved extension of the egress carve-out to COMPLIANCE documents
 * (owner decision 2026-08-12; migration 014). docs/12 §6 originally scoped
 * file-content crossings to the `library` bucket alone, with `model-documents`
 * — performers' identity papers — unreachable "by any path". The owner has
 * explicitly extended AI analysis to those documents, under a consent model
 * STRICTER than the library channel's:
 *
 *  • Per-document opt-in, default OFF. A document that has never been opted in
 *    cannot cross; this function refuses it with `RedactionRefusedError`.
 *  • The flag is read at crossing time by the caller and passed here, so
 *    turning it off takes effect on the next analysis immediately.
 *  • Only the extracted content crosses — like the library channel, this
 *    function structurally cannot carry `storage_path`, uploader identity,
 *    `model_id`, or any neighbouring row. The global field blocklist still
 *    governs everything except the content itself.
 *  • Auditing (`ai.analyse`) and metering (`ai_usage`) of each crossing are the
 *    caller's responsibility, exactly as for library classification.
 *
 * This is the second, and only other, owner-approved exception to the
 * aggregates-only policy. Do not add a third path.
 */
export function complianceAnalysisChannel(
  input: ComplianceAnalysisChannelInput,
): ClassificationContent {
  if (!input.aiAnalysisOptIn) {
    throw new RedactionRefusedError("not_opted_in");
  }
  return input.content;
}
