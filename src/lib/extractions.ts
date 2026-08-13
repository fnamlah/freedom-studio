import { z } from "zod";

import type { AiSupabaseClient } from "./ai/types";
import type { Enums, Json } from "./database.types";
import type { Dictionary } from "./i18n";
import { isValidYmd } from "./forms";

/**
 * Proposed records from uploaded documents (migration 021).
 *
 * The AI crossings that already read files — `classifyFile` (Library) and
 * `analyseDocument` (Documents) — can return, alongside their existing answer,
 * the ROWS a bookkeeper would have typed from the document: a payout statement's
 * earnings lines, a shift export's sessions, a receipt's expense. Those rows are
 * staged in `doc_extractions` and NEVER written to a business table until a
 * human reviews them on `/documents/inbox` and applies them — through the same
 * zod schemas the manual forms use, under the caller's own RLS, with
 * `source='import'` (the `entry_source` value reserved since migration 001).
 *
 * This module is the shared vocabulary of that pipeline: the payload schemas
 * (what a model may propose and what the DB row's `payload` holds), the
 * platform-account matcher, and the one staging-row writer. It deliberately
 * contains NO crossing logic — content leaves the system only through the two
 * redactor channels, which are untouched by any of this.
 *
 * Imports are relative, not aliased: `extractions.test.ts` runs under the node
 * test runner, which does not resolve the `@/` alias.
 */

/* ------------------------------------------------------------- row schemas --- */

/**
 * Model-output tolerances, deliberately wider than the apply-time schemas: a
 * provider may return numbers as strings (amounts coerce) and is fond of
 * emitting explicit `null` or `""` where it means "not present" — every
 * OPTIONAL field here treats those as absence, because "the model said
 * nothing" must not vaporise a whole proposal. What it may NOT do is guess —
 * the prompt orders omission over invention, and dates that are not full,
 * REAL calendar values fail validation and drop the whole records block
 * rather than letting a half-read date reach the review screen looking
 * authoritative.
 */

/** Optional-field leniency: explicit null / "" mean the same as absent. */
const lenient = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    inner.optional(),
  );

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidYmd);

/**
 * `datetime-local` shape — exactly what the manual sessions form submits —
 * with the calendar/clock validated: "…T24:00" (a common shift-report
 * convention this system does not use) would render as a BLANK datetime input
 * while the junk value still submitted, so it is rejected here instead.
 */
const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
  .refine((value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!m) return false;
    const [y, mo, day, h, mi, sec] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, day, h, mi, sec));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === mo - 1 &&
      dt.getUTCDate() === day &&
      dt.getUTCHours() === h &&
      dt.getUTCMinutes() === mi
    );
  });

const money = z.coerce.number().finite().min(0).max(9_999_999_999.99);

const currency3 = lenient(
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z]{3}$/),
  ),
);

const printedText = (max: number) => z.string().trim().min(1).max(max);

/** One line of a platform payout statement, as printed on the document. */
export const earningRecordSchema = z.object({
  /** Platform and username exactly as printed — resolved to an account later. */
  platform: lenient(printedText(80)),
  username: lenient(printedText(120)),
  period_start: isoDate,
  period_end: isoDate,
  gross_amount: money,
  fee_amount: lenient(money),
  net_amount: money,
  currency: currency3,
});
export type EarningRecord = z.infer<typeof earningRecordSchema>;

/** One shift from a work report. */
export const sessionRecordSchema = z.object({
  platform: lenient(printedText(80)),
  username: lenient(printedText(120)),
  started_at: isoDateTime,
  ended_at: lenient(isoDateTime),
  gross_earnings: lenient(money),
  currency: currency3,
  notes: lenient(z.string().trim().max(400)),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

/** One studio cost from a receipt or invoice. */
export const expenseRecordSchema = z.object({
  incurred_on: isoDate,
  vendor: printedText(200),
  description: lenient(z.string().trim().max(2000)),
  amount: z.coerce.number().finite().positive().max(9_999_999_999.99),
  currency: currency3,
  category: lenient(z.string().trim().max(100)),
});
export type ExpenseRecord = z.infer<typeof expenseRecordSchema>;

/**
 * The optional `records` block of a classifier response. A document proposes
 * rows of exactly ONE kind — that is also the staging table's unique key,
 * `(source_kind, source_id, kind)`. Fifty rows is far above any real statement;
 * the cap is there so a hallucinating model cannot flood the review queue.
 */
export const extractedRecordsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("earnings"), rows: z.array(earningRecordSchema).min(1).max(50) }),
  z.object({ kind: z.literal("sessions"), rows: z.array(sessionRecordSchema).min(1).max(50) }),
  z.object({ kind: z.literal("expenses"), rows: z.array(expenseRecordSchema).min(1).max(50) }),
]);
export type ExtractedRecords = z.infer<typeof extractedRecordsSchema>;

/**
 * Parse the `records` block out of a model response. Returns undefined for
 * anything malformed: records are a bonus on top of classification, and a bad
 * bonus must never fail — or taint — the primary answer.
 */
export function parseRecords(raw: unknown): ExtractedRecords | undefined {
  if (raw == null) return undefined;
  const parsed = extractedRecordsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** What a `document_meta` proposal carries: the diff and what it would replace. */
export type DocumentMetaPayload = {
  /** Only fields that differ from the stored row. */
  fields: Partial<{
    doc_type: string;
    title: string;
    issued_date: string;
    expires_at: string;
  }>;
  /** The row's values at proposal time, so the reviewer sees both sides. */
  current: Partial<{
    doc_type: string | null;
    title: string | null;
    issued_date: string | null;
    expires_at: string | null;
  }>;
};

/* --------------------------------------------------------- expense fields --- */

/**
 * Apply-time validation for expense rows. Expenses have no manual form yet —
 * the inbox is their first entry path — so this factory IS the canonical
 * schema: any future manual expenses form must import it, exactly as the inbox
 * imports `earningFields` and `sessionFields` from their areas. Mirrors the DB:
 * `amount > 0`, `vendor` required, `incurred_on` a real date (021).
 */
export const expenseFields = (d: Dictionary) => ({
  incurred_on: z.string().refine(isValidYmd, d.documents.inbox.errDateInvalid),
  vendor: z
    .string()
    .trim()
    .min(1, d.documents.inbox.errVendorRequired)
    .max(200, d.documents.inbox.errVendorTooLong),
  description: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(2000, d.documents.inbox.errDescriptionTooLong).nullable(),
    )
    .optional(),
  amount: z.coerce
    .number({ invalid_type_error: d.documents.inbox.errAmountType })
    .positive(d.documents.inbox.errAmountPositive)
    .max(9_999_999_999.99, d.documents.inbox.errAmountTooLarge),
  currency: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.documents.inbox.errCurrency),
  ),
  category: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(100, d.documents.inbox.errCategoryTooLong).nullable(),
    )
    .optional(),
});

/* -------------------------------------------------------- account matching --- */

export type AccountCandidate = {
  id: string;
  username: string;
  platformName: string;
};

const normalizeHandle = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/^@+/, "");

/**
 * Match what a statement PRINTS to a platform account the studio actually has.
 *
 * Mirrors the rule `resolveAccountModel` enforces on the manual path: the
 * account decides the model, never the other way round — so nothing here ever
 * guesses. Username is the strong key (exact, case-insensitive, `@` stripped);
 * when two platforms share a username, the printed platform name breaks the
 * tie. Zero or several survivors → null, and the reviewer picks by hand.
 */
export function matchAccount(
  printed: { platform?: string; username?: string },
  accounts: readonly AccountCandidate[],
): string | null {
  const username = normalizeHandle(printed.username);
  if (!username) return null;

  const byUsername = accounts.filter((a) => normalizeHandle(a.username) === username);
  if (byUsername.length === 1) return byUsername[0].id;
  if (byUsername.length === 0) return null;

  const platform = normalizeHandle(printed.platform);
  if (!platform) return null;
  const byPlatform = byUsername.filter((a) => {
    const name = normalizeHandle(a.platformName);
    return name === platform || name.includes(platform) || platform.includes(name);
  });
  return byPlatform.length === 1 ? byPlatform[0].id : null;
}

/* ------------------------------------------------------------ staging row --- */

export type ProposalInput = {
  sourceKind: Enums<"doc_source_kind">;
  sourceId: string;
  kind: Enums<"doc_extraction_kind">;
  payload: Json;
  confidence: number | null;
  provider: Enums<"ai_provider"> | null;
  model: string | null;
  userId: string;
};

/**
 * Stage one proposal, idempotently.
 *
 * `(source_kind, source_id, kind)` is unique (021): re-running the analyser on
 * the same file must refresh the live proposal, not stack a duplicate. But a
 * proposal a human has already DECIDED — applied or dismissed — stays decided:
 * re-analysis must not resurrect it and quietly re-queue rows someone rejected.
 * Hence read-then-write instead of an unconditional upsert.
 *
 * Runs under the caller's RLS (SA/MGR hold all on `doc_extractions`). Failures
 * are swallowed by the callers on purpose — a staging hiccup must never fail
 * the classification that produced it.
 */
export async function persistProposal(
  supabase: AiSupabaseClient,
  input: ProposalInput,
): Promise<void> {
  const { data: existing } = await supabase
    .from("doc_extractions")
    .select("id, state")
    .eq("source_kind", input.sourceKind)
    .eq("source_id", input.sourceId)
    .eq("kind", input.kind)
    .maybeSingle();

  if (!existing) {
    await supabase.from("doc_extractions").insert({
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      kind: input.kind,
      payload: input.payload,
      confidence: input.confidence,
      provider: input.provider,
      model: input.model,
      created_by: input.userId,
    });
    return;
  }

  if (existing.state === "proposed") {
    await supabase
      .from("doc_extractions")
      .update({
        payload: input.payload,
        confidence: input.confidence,
        provider: input.provider,
        model: input.model,
      })
      .eq("id", existing.id);
  }
  // applied / dismissed / failed: the human (or the error) has spoken — no-op.
}
