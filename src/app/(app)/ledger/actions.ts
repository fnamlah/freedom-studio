"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import { describeDbError, firstIssue, type SqlStateMessages } from "@/lib/forms";

/**
 * Ledger mutations — the maker-checker accounting core (docs/09 §5).
 *
 * Two write paths, both restricted to Super Admin + Finance (docs/03 §3:
 * "Ledger entries" = SA/FIN create+read, no U/D; "Run earning-share generation"
 * RPC = SA/FIN):
 *
 *   • postLedgerEntry — a manual `adjustment` (±) or `deduction` (−). The ledger
 *     is APPEND-ONLY for every role including Super Admin (docs/04 §4.10 has no
 *     UPDATE/DELETE policy); a wrong posting is corrected by a reversing entry,
 *     never an edit. `earning_share` and `payout_settlement` are NEVER posted here
 *     — the first comes from `fn_generate_earning_shares`, the second only from the
 *     settlement trigger (docs/09 §5.1).
 *
 *   • closePeriod — runs `fn_generate_earning_shares(from, to)` (docs/09 §5.3).
 *     Idempotent: keyed per `(earning_id, payee)`, a re-run skips already-posted
 *     pairs, so a late-arriving earning row for a closed period just needs a re-run.
 *     Returns posted/skipped counts for the UI.
 *
 * Every mutation opens with `requireRole("super_admin", "finance")`, which
 * redirects an unauthorized caller before any work runs, then writes through the
 * caller's own RLS-scoped client (RLS is the final authority) and appends a
 * `ledger.post` audit row (docs/04 §4.16).
 *
 * Every message the client can surface is resolved from the CALLER's dictionary
 * — `requireRole` already loaded their profile, so the locale is free.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export type ClosePeriodResult =
  | { ok: true; posted: number; skipped: number; message?: string }
  | { ok: false; error: string };

/* -------------------------------------------------------------- validation --- */

/** Parses a strict `YYYY-MM-DD` and rejects impossible calendar dates. */
function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  return (
    asDate.getUTCFullYear() === y &&
    asDate.getUTCMonth() === m - 1 &&
    asDate.getUTCDate() === d
  );
}

/**
 * The schemas are FACTORIES, not module constants. A module-scope `z.object`
 * is evaluated at import time, long before any request exists, so its messages
 * could only ever be in one language; building it inside the action lets every
 * message come from the caller's own dictionary.
 */
const dateOnly = (d: Dictionary) => z.string().refine(isValidYmd, d.money.ledger.errInvalidDate);

const currencyField = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.money.ledger.errCurrency),
  );

/** Signed money magnitude, non-zero (the ledger CHECK forbids `amount = 0`). */
const signedAmount = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.money.ledger.errEnterAmount })
    .refine((n) => Number.isFinite(n), d.money.ledger.errEnterAmount)
    .refine((n) => Math.abs(n) >= 0.01, d.money.ledger.errAmountZero)
    .refine((n) => Math.abs(n) <= 9_999_999_999.99, d.money.ledger.errAmountTooLarge);

const postEntrySchema = (d: Dictionary) =>
  z.object({
    payee_type: z.enum(["model", "operator"], {
      errorMap: () => ({ message: d.money.ledger.errChoosePayee }),
    }),
    payee_id: z.string().uuid(d.money.ledger.errChoosePayee),
    entry_type: z.enum(["adjustment", "deduction"], {
      errorMap: () => ({ message: d.money.ledger.errChooseEntryType }),
    }),
    amount: signedAmount(d),
    currency: currencyField(d),
    description: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().max(500, d.money.ledger.errNoteTooLong).nullable().optional(),
    ),
  });

const closePeriodSchema = (d: Dictionary) =>
  z
    .object({ period_start: dateOnly(d), period_end: dateOnly(d) })
    .refine((v) => v.period_end >= v.period_start, {
      message: d.money.ledger.errPeriodOrder,
      path: ["period_end"],
    });

/* ------------------------------------------------------------------ types --- */

export type PostLedgerEntryInput = {
  payee_type: "model" | "operator";
  payee_id: string;
  entry_type: "adjustment" | "deduction";
  amount: string | number;
  currency?: string;
  description?: string | null;
};

export type ClosePeriodInput = { period_start: string; period_end: string };

/* ---------------------------------------------------------------- helpers --- */

/* -------------------------------------------------------------- post entry --- */

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
function dbMessages(d: Dictionary): SqlStateMessages {
  return { "23514": d.money.ledger.errDbZero, "23503": d.money.ledger.errDbMissingRef, "42501": d.money.ledger.errNotAuthorizedPost };
}

export async function postLedgerEntry(input: PostLedgerEntryInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "finance");
  const d = dict(toLocale(profile.locale));

  const parsed = postEntrySchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.ledger.errCheckForm) };
  }
  const data = parsed.data;

  // Enforce the sign convention (docs/09 §5.1): a deduction is always negative;
  // an adjustment keeps the sign the finance user entered (+ credit / − reversal).
  const amount =
    data.entry_type === "deduction" ? -Math.abs(data.amount) : data.amount;

  try {
    const { data: created, error } = await supabase
      .from("ledger_entries")
      .insert({
        payee_type: data.payee_type,
        payee_id: data.payee_id,
        entry_type: data.entry_type,
        amount,
        currency: data.currency,
        description: data.description ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code, dbMessages(d), d.money.ledger.errPostFailed) };
    }

    await writeAudit({
      action: "ledger.post",
      entityType: "ledger_entry",
      entityId: created.id,
      metadata: {
        payee_type: data.payee_type,
        payee_id: data.payee_id,
        entry_type: data.entry_type,
        amount,
        currency: data.currency,
      },
    });

    revalidatePath("/ledger");
    revalidatePath("/statements");
    return {
      ok: true,
      message:
        data.entry_type === "deduction"
          ? d.money.ledger.okDeductionPosted
          : d.money.ledger.okAdjustmentPosted,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.ledger.errNotAuthorizedPost };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------- close period --- */

export async function closePeriod(input: ClosePeriodInput): Promise<ClosePeriodResult> {
  const { supabase, profile } = await requireRole("super_admin", "finance");
  const d = dict(toLocale(profile.locale));

  const parsed = closePeriodSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.ledger.errCheckForm) };
  }
  const { period_start, period_end } = parsed.data;

  try {
    const { data, error } = await supabase.rpc("fn_generate_earning_shares", {
      p_period_start: period_start,
      p_period_end: period_end,
    });

    if (error) {
      if (error.code === "42501") {
        return { ok: false, error: d.money.ledger.errNotAuthorizedClose };
      }
      return { ok: false, error: d.money.ledger.errCloseFailed };
    }

    const summary = Array.isArray(data) ? data[0] : data;
    const posted = Number(summary?.posted_count ?? 0);
    const skipped = Number(summary?.skipped_count ?? 0);

    await writeAudit({
      action: "ledger.post",
      entityType: "period",
      entityId: `${period_start}..${period_end}`,
      metadata: { period_start, period_end, posted, skipped, run: "generate_earning_shares" },
    });

    revalidatePath("/ledger");
    revalidatePath("/statements");
    return {
      ok: true,
      posted,
      skipped,
      message: d.money.ledger.okCloseSummary(posted, skipped),
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.ledger.errNotAuthorizedClose };
    }
    return { ok: false, error: d.money.ledger.errShareGeneration };
  }
}
