"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import { describeDbError, firstIssue } from "@/lib/forms";
import { expenseFields } from "@/lib/extractions";
import type { Enums, Json, TablesUpdate } from "@/lib/database.types";

import {
  earningDbMessages,
  earningFields,
  periodOrdered,
  periodOrderedMessage,
} from "../../earnings/earning-fields";
import { normalizeTimes, sessionDbMessages, sessionFields } from "../../sessions/session-fields";
import { documentMetaFields } from "../meta-fields";

/**
 * The inbox's decision actions (migration 021): apply or dismiss what the AI
 * proposed. This is the moment staged rows become business records, so the
 * rules are strict and deliberately boring:
 *
 *   • Super Admin + Manager only — the same people the manual forms allow.
 *   • Every row is validated by THE SAME field schemas the manual forms use
 *     (`earningFields`, `sessionFields`, `documentMetaFields`; `expenseFields`
 *     is canonical since expenses have no manual form yet). An AI-proposed row
 *     cannot bypass a rule a typed row obeys.
 *   • `model_id` is derived server-side from the chosen account, exactly as
 *     the manual path does — a client-supplied model id is never trusted.
 *   • Inserts run under the caller's own RLS with `source='import'` — the
 *     `entry_source` value reserved for this since migration 001, written here
 *     for the first time. RLS stays the final authority.
 *   • Batch inserts are ONE statement, so an apply is all-or-nothing: a
 *     proposal can never be left half-recorded. Earnings additionally upsert
 *     with `ignoreDuplicates` against `earnings_stmt_unique`, so re-applying
 *     the same statement is idempotent — duplicates are reported, not errors.
 *   • A proposal is decided EXACTLY ONCE, and that is enforced atomically:
 *     the decision is a compare-and-set (`state='proposed'` → decided) taken
 *     BEFORE any business row is written. Two tabs racing the same proposal
 *     — or an apply racing a dismiss — resolve to one winner in the database;
 *     the loser reads zero rows back and reports the proposal as decided.
 *     `work_sessions` and `expenses` have no natural unique key, so this claim
 *     is their entire double-write protection (hermes_approvals solved the
 *     same problem with `select … for update`; a CAS is the PostgREST shape
 *     of the same idea). If the insert then fails, the claim is REVERTED with
 *     `last_error` — nothing was written (the batch is atomic), so
 *     `'proposed'` is once again the truthful state.
 */

export type ActionResult =
  | { ok: true; message?: string }
  | {
      ok: false;
      error: string;
      /**
       * The proposal was already decided (or deleted) elsewhere — the client
       * refreshes to drop the stale card. Validation failures deliberately do
       * NOT set this: a refresh would throw away the reviewer's edits.
       */
      gone?: boolean;
    };

type Extraction = {
  id: string;
  source_kind: Enums<"doc_source_kind">;
  source_id: string;
  kind: Enums<"doc_extraction_kind">;
  state: Enums<"doc_extraction_state">;
};

type Ctx = Awaited<ReturnType<typeof requireRole>>;

/**
 * Atomically CLAIM a proposal: one UPDATE that both checks and takes the
 * decision — `state='proposed'` (and, for apply, the expected kind) is in the
 * WHERE clause, so of any number of concurrent deciders exactly one gets a row
 * back. The losers read nothing and report the proposal as decided (`gone`),
 * which tells the client to drop the stale card.
 *
 * The claim happens BEFORE any business row is written. That order is the
 * whole point: sessions and expenses have no unique key, so this single
 * statement is what makes "decided exactly once" true under concurrency, not
 * just in the happy path. The update's error is checked — a claim that cannot
 * be recorded is a claim that was never made.
 */
async function claimProposal(
  supabase: Ctx["supabase"],
  id: string,
  kind: Extraction["kind"] | null,
  decided: "applied" | "dismissed",
  userId: string,
  failError: string,
  d: Dictionary,
): Promise<{ ok: true; extraction: Extraction } | { ok: false; error: string; gone?: boolean }> {
  let query = supabase
    .from("doc_extractions")
    .update({ state: decided, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("state", "proposed");
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query
    .select("id, source_kind, source_id, kind, state")
    .maybeSingle();

  if (error) return { ok: false, error: failError };
  if (!data) return { ok: false, error: d.documents.inbox.errGone, gone: true };
  return { ok: true, extraction: data };
}

/**
 * Put a claimed proposal back after a failed insert. Nothing was written (the
 * batch is one atomic statement), so `'proposed'` is again the truthful state;
 * `last_error` says why it bounced. Conditional on the state WE set, so a
 * concurrent decision can never be overwritten. Best-effort: if this update
 * itself fails the row stays 'applied' with no business rows — visible in the
 * audit trail, and unreachable only when the database is already unreachable.
 */
async function revertClaim(
  supabase: Ctx["supabase"],
  id: string,
  message: string | undefined,
): Promise<void> {
  await supabase
    .from("doc_extractions")
    .update({
      state: "proposed",
      reviewed_by: null,
      reviewed_at: null,
      last_error: (message ?? "insert failed").slice(0, 500),
    })
    .eq("id", id)
    .eq("state", "applied");
}

/**
 * Record what the apply produced. Deliberately non-fatal: by the time this
 * runs the decision AND the rows are already correct in the database — a
 * hiccup here loses only the informational summary, never correctness.
 */
async function stampResult(supabase: Ctx["supabase"], id: string, result: Json): Promise<void> {
  await supabase.from("doc_extractions").update({ result }).eq("id", id);
}

/**
 * Resolve each account to its owning model in ONE query. The account decides
 * the model — the same invariant `resolveAccountModel` enforces on the manual
 * path; an id that resolves to nothing fails the whole apply.
 */
async function resolveModels(
  supabase: Ctx["supabase"],
  accountIds: string[],
  d: Dictionary,
): Promise<{ ok: true; modelByAccount: Map<string, string> } | { ok: false; error: string }> {
  const unique = [...new Set(accountIds)];
  const { data, error } = await supabase
    .from("platform_accounts")
    .select("id, model_id")
    .in("id", unique);

  if (error) return { ok: false, error: d.studio.earnings.errVerifyAccount };
  const modelByAccount = new Map((data ?? []).map((a) => [a.id, a.model_id] as const));
  if (unique.some((id) => !modelByAccount.has(id))) {
    return { ok: false, error: d.studio.earnings.errAccountFk };
  }
  return { ok: true, modelByAccount };
}

const idSchema = z.string().uuid();

/* ---------------------------------------------------------------- earnings --- */

export type ApplyEarningRow = {
  platform_account_id: string;
  period_start: string;
  period_end: string;
  gross_amount: string | number;
  platform_fee_amount?: string | number | null;
  net_amount: string | number;
  currency?: string;
};

export async function applyEarnings(input: {
  extraction_id: string;
  rows: ApplyEarningRow[];
}): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const schema = z.object({
    extraction_id: idSchema,
    rows: z
      .array(z.object(earningFields(d)).refine(periodOrdered, periodOrderedMessage(d)))
      .min(1, d.documents.inbox.errNoRows)
      .max(50),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.inbox.errCheckRows) };
  }
  const rows = parsed.data.rows;

  try {
    // Validation and account resolution happen BEFORE the claim, so a request
    // that could never insert does not bounce the proposal through a decided
    // state; the claim itself is the atomic decide-once gate.
    const owners = await resolveModels(
      supabase,
      rows.map((r) => r.platform_account_id),
      d,
    );
    if (!owners.ok) return owners;

    const gate = await claimProposal(
      supabase,
      parsed.data.extraction_id,
      "earnings",
      "applied",
      user.id,
      d.documents.inbox.errApplyFailed,
      d,
    );
    if (!gate.ok) return gate;

    // One statement, so the batch is atomic; `ignoreDuplicates` turns the
    // statement-unique collision (23505 on earnings_stmt_unique) into a
    // skipped row instead of an error — re-applying is idempotent, and only
    // genuinely new rows come back from `select`.
    const { data: created, error } = await supabase
      .from("earnings")
      .upsert(
        rows.map((r) => ({
          model_id: owners.modelByAccount.get(r.platform_account_id)!,
          platform_account_id: r.platform_account_id,
          period_start: r.period_start,
          period_end: r.period_end,
          gross_amount: r.gross_amount,
          platform_fee_amount: r.platform_fee_amount,
          net_amount: r.net_amount,
          currency: r.currency,
          entered_by: user.id,
          source: "import" as const,
        })),
        { onConflict: "platform_account_id,period_start,period_end", ignoreDuplicates: true },
      )
      .select("id, model_id, platform_account_id, period_start, period_end");

    if (error) {
      await revertClaim(supabase, gate.extraction.id, error.message);
      return {
        ok: false,
        error: describeDbError(error.code, earningDbMessages(d), d.documents.inbox.errApplyFailed),
      };
    }

    const createdRows = created ?? [];
    const duplicates = rows.length - createdRows.length;

    // A "duplicate" only proves the PERIOD was already recorded — not that the
    // amounts agree. A skipped row whose stored figures differ from what this
    // statement shows is exactly the collision a reviewer must hear about
    // (the manual path surfaces it as an error; silence here would make the
    // import path the only way to lose conflicting money figures unnoticed).
    const differing =
      duplicates > 0 ? await countDifferingDuplicates(supabase, rows, createdRows) : 0;

    await stampResult(supabase, gate.extraction.id, {
      created: createdRows.map((r) => r.id),
      created_count: createdRows.length,
      duplicate_count: duplicates,
      differing_count: differing,
    });

    await writeAudit({
      action: "extraction.apply",
      entityType: "doc_extraction",
      entityId: gate.extraction.id,
      metadata: {
        kind: "earnings",
        source_kind: gate.extraction.source_kind,
        source_id: gate.extraction.source_id,
        earning_ids: createdRows.map((r) => r.id),
        created_count: createdRows.length,
        duplicate_count: duplicates,
      },
    });

    revalidatePath("/documents/inbox");
    revalidatePath("/earnings");
    revalidatePath("/dashboard");
    for (const modelId of new Set(createdRows.map((r) => r.model_id))) {
      revalidatePath(`/models/${modelId}`);
    }

    return { ok: true, message: appliedMessage(d, createdRows.length, duplicates, differing) };
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.inbox.errNotAuthorized };
    return { ok: false, error: d.common.unknownError };
  }
}

function appliedMessage(
  d: Dictionary,
  created: number,
  duplicates: number,
  differing: number,
): string {
  const base =
    created === 0 && duplicates > 0
      ? d.documents.inbox.okAllDuplicates
      : duplicates > 0
        ? d.documents.inbox.okAppliedWithDuplicates(created, duplicates)
        : d.documents.inbox.okApplied(created);
  return differing > 0 ? `${base} ${d.documents.inbox.okDuplicatesDiffer(differing)}` : base;
}

/**
 * Of the rows the upsert SKIPPED, how many collide with stored figures that
 * disagree with the statement? Compared at the 2-decimal money grain.
 * Best-effort: an unreadable comparison must not fail an apply that already
 * succeeded — it only softens the message.
 */
async function countDifferingDuplicates(
  supabase: Ctx["supabase"],
  rows: {
    platform_account_id: string;
    period_start: string;
    period_end: string;
    gross_amount: number;
    platform_fee_amount: number;
    net_amount: number;
  }[],
  createdRows: { platform_account_id: string; period_start: string; period_end: string }[],
): Promise<number> {
  const key = (r: { platform_account_id: string; period_start: string; period_end: string }) =>
    `${r.platform_account_id}|${r.period_start}|${r.period_end}`;
  const createdKeys = new Set(createdRows.map(key));
  const skipped = rows.filter((r) => !createdKeys.has(key(r)));
  if (skipped.length === 0) return 0;

  const { data: existing, error } = await supabase
    .from("earnings")
    .select(
      "platform_account_id, period_start, period_end, gross_amount, platform_fee_amount, net_amount",
    )
    .in("platform_account_id", [...new Set(skipped.map((r) => r.platform_account_id))])
    .in("period_start", skipped.map((r) => r.period_start))
    .in("period_end", skipped.map((r) => r.period_end));
  if (error) return 0;

  const cents = (v: string | number) => Math.round(Number(v) * 100);
  const byKey = new Map((existing ?? []).map((e) => [key(e), e]));
  return skipped.filter((r) => {
    const stored = byKey.get(key(r));
    if (!stored) return false;
    return (
      cents(stored.gross_amount) !== cents(r.gross_amount) ||
      cents(stored.platform_fee_amount) !== cents(r.platform_fee_amount) ||
      cents(stored.net_amount) !== cents(r.net_amount)
    );
  }).length;
}

/* ---------------------------------------------------------------- sessions --- */

export type ApplySessionRow = {
  platform_account_id: string;
  started_at: string;
  ended_at?: string | null;
  gross_earnings: string | number;
  currency?: string;
  notes?: string | null;
};

export async function applySessions(input: {
  extraction_id: string;
  rows: ApplySessionRow[];
}): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const schema = z.object({
    extraction_id: idSchema,
    rows: z.array(z.object(sessionFields(d))).min(1, d.documents.inbox.errNoRows).max(50),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.inbox.errCheckRows) };
  }

  // Same wall-clock-as-UTC normalization + ordering guard as the manual form.
  const normalized: { startedAt: string; endedAt: string | null }[] = [];
  for (const row of parsed.data.rows) {
    const times = normalizeTimes(row.started_at, row.ended_at, d);
    if (!times.ok) return times;
    normalized.push({ startedAt: times.startedAt, endedAt: times.endedAt });
  }

  try {
    const owners = await resolveModels(
      supabase,
      parsed.data.rows.map((r) => r.platform_account_id),
      d,
    );
    if (!owners.ok) return owners;

    // Sessions carry no natural unique key, so the atomic CLAIM above the
    // insert is their entire double-write protection: exactly one request
    // wins the compare-and-set, and the loser never reaches this insert.
    // The insert itself is ONE statement — there is no partial to re-apply;
    // if it fails, the claim is reverted and the proposal stays reviewable.
    const gate = await claimProposal(
      supabase,
      parsed.data.extraction_id,
      "sessions",
      "applied",
      user.id,
      d.documents.inbox.errApplyFailed,
      d,
    );
    if (!gate.ok) return gate;

    const { data: created, error } = await supabase
      .from("work_sessions")
      .insert(
        parsed.data.rows.map((r, i) => ({
          model_id: owners.modelByAccount.get(r.platform_account_id)!,
          platform_account_id: r.platform_account_id,
          started_at: normalized[i].startedAt,
          ended_at: normalized[i].endedAt,
          gross_earnings: r.gross_earnings,
          currency: r.currency,
          notes: r.notes ?? null,
          entered_by: user.id,
          source: "import" as const,
        })),
      )
      .select("id");

    if (error) {
      await revertClaim(supabase, gate.extraction.id, error.message);
      return {
        ok: false,
        error: describeDbError(error.code, sessionDbMessages(d), d.documents.inbox.errApplyFailed),
      };
    }

    const ids = (created ?? []).map((r) => r.id);
    await stampResult(supabase, gate.extraction.id, {
      created: ids,
      created_count: ids.length,
    });

    await writeAudit({
      action: "extraction.apply",
      entityType: "doc_extraction",
      entityId: gate.extraction.id,
      metadata: {
        kind: "sessions",
        source_kind: gate.extraction.source_kind,
        source_id: gate.extraction.source_id,
        session_ids: ids,
        created_count: ids.length,
      },
    });

    revalidatePath("/documents/inbox");
    revalidatePath("/sessions");
    return { ok: true, message: d.documents.inbox.okApplied(ids.length) };
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.inbox.errNotAuthorized };
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------------- expenses --- */

export type ApplyExpenseRow = {
  incurred_on: string;
  vendor: string;
  description?: string | null;
  amount: string | number;
  currency?: string;
  category?: string | null;
};

export async function applyExpenses(input: {
  extraction_id: string;
  rows: ApplyExpenseRow[];
}): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const schema = z.object({
    extraction_id: idSchema,
    rows: z.array(z.object(expenseFields(d))).min(1, d.documents.inbox.errNoRows).max(50),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.inbox.errCheckRows) };
  }

  try {
    // Expenses have no unique key either — the atomic claim is the guard.
    const gate = await claimProposal(
      supabase,
      parsed.data.extraction_id,
      "expenses",
      "applied",
      user.id,
      d.documents.inbox.errApplyFailed,
      d,
    );
    if (!gate.ok) return gate;

    const { data: created, error } = await supabase
      .from("expenses")
      .insert(
        parsed.data.rows.map((r) => ({
          incurred_on: r.incurred_on,
          vendor: r.vendor,
          description: r.description ?? null,
          amount: r.amount,
          currency: r.currency,
          category: r.category ?? null,
          // The receipt this came from, when it came from one.
          library_file_id:
            gate.extraction.source_kind === "library_file" ? gate.extraction.source_id : null,
          source: "import" as const,
          created_by: user.id,
        })),
      )
      .select("id");

    if (error) {
      await revertClaim(supabase, gate.extraction.id, error.message);
      // 23503 here can only be the receipt's library_file FK racing a delete.
      return {
        ok: false,
        error: describeDbError(
          error.code,
          { "23503": d.documents.inbox.errGone },
          d.documents.inbox.errApplyFailed,
        ),
      };
    }

    const ids = (created ?? []).map((r) => r.id);
    await stampResult(supabase, gate.extraction.id, {
      created: ids,
      created_count: ids.length,
    });

    await writeAudit({
      action: "extraction.apply",
      entityType: "doc_extraction",
      entityId: gate.extraction.id,
      metadata: {
        kind: "expenses",
        source_kind: gate.extraction.source_kind,
        source_id: gate.extraction.source_id,
        expense_ids: ids,
        created_count: ids.length,
      },
    });

    revalidatePath("/documents/inbox");
    return { ok: true, message: d.documents.inbox.okApplied(ids.length) };
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.inbox.errNotAuthorized };
    return { ok: false, error: d.common.unknownError };
  }
}

/* ----------------------------------------------------------- document meta --- */

export type ApplyMetaFields = {
  doc_type?: string;
  title?: string;
  issued_date?: string;
  expires_at?: string;
};

export async function applyDocumentMeta(input: {
  extraction_id: string;
  fields: ApplyMetaFields;
}): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  // The SAME field rules as the upload form, each optional here — the reviewer
  // chooses which of the proposed fields to keep.
  const schema = z.object({
    extraction_id: idSchema,
    fields: z.object(documentMetaFields(d)).partial(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.documents.inbox.errCheckRows) };
  }
  // Values only, nulls out: the inbox APPLIES what a document proposes; it is
  // never a path to clear a field. Blanking a compliance date happens nowhere.
  const f = parsed.data.fields;
  const fields: TablesUpdate<"documents"> = {};
  if (f.doc_type != null) fields.doc_type = f.doc_type;
  if (f.title != null) fields.title = f.title;
  if (f.issued_date != null) fields.issued_date = f.issued_date;
  if (f.expires_at != null) fields.expires_at = f.expires_at;
  if (Object.keys(fields).length === 0) {
    return { ok: false, error: d.documents.inbox.errNoFields };
  }

  try {
    const gate = await claimProposal(
      supabase,
      parsed.data.extraction_id,
      "document_meta",
      "applied",
      user.id,
      d.documents.inbox.errApplyFailed,
      d,
    );
    if (!gate.ok) return gate;

    const { data: updated, error } = await supabase
      .from("documents")
      .update(fields)
      .eq("id", gate.extraction.source_id)
      .select("id, model_id")
      .maybeSingle();

    if (error) {
      await revertClaim(supabase, gate.extraction.id, error.message);
      return { ok: false, error: d.documents.inbox.errApplyFailed };
    }
    if (!updated) {
      await revertClaim(supabase, gate.extraction.id, "document row gone");
      return { ok: false, error: d.documents.inbox.errDocumentGone };
    }

    await stampResult(supabase, gate.extraction.id, {
      updated_fields: Object.keys(fields),
    });

    await writeAudit({
      action: "extraction.apply",
      entityType: "doc_extraction",
      entityId: gate.extraction.id,
      metadata: {
        kind: "document_meta",
        document_id: gate.extraction.source_id,
        model_id: updated.model_id,
        updated_fields: Object.keys(fields),
      },
    });

    revalidatePath("/documents/inbox");
    revalidatePath("/documents");
    return { ok: true, message: d.documents.inbox.okMetaApplied };
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.inbox.errNotAuthorized };
    return { ok: false, error: d.common.unknownError };
  }
}

/* ----------------------------------------------------------------- dismiss --- */

export async function dismissExtraction(input: { extraction_id: string }): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = z.object({ extraction_id: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: d.documents.inbox.errGone };

  try {
    // Any still-proposed kind may be dismissed — the claim returns the row's
    // own kind for the audit trail, and its checked error is what makes the
    // "could not dismiss" message truthful (a failed update never reports
    // success or writes a dismiss audit record for a decision that did not
    // take effect).
    const gate = await claimProposal(
      supabase,
      parsed.data.extraction_id,
      null,
      "dismissed",
      user.id,
      d.documents.inbox.errDismissFailed,
      d,
    );
    if (!gate.ok) return gate;
    const data = gate.extraction;

    await writeAudit({
      action: "extraction.dismiss",
      entityType: "doc_extraction",
      entityId: data.id,
      metadata: { kind: data.kind, source_kind: data.source_kind, source_id: data.source_id },
    });

    revalidatePath("/documents/inbox");
    return { ok: true, message: d.documents.inbox.okDismissed };
  } catch (error) {
    if (isAuthzError(error)) return { ok: false, error: d.documents.inbox.errNotAuthorized };
    return { ok: false, error: d.common.unknownError };
  }
}
