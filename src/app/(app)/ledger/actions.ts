"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { isAuthzError } from "@/lib/supabase/admin";

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

const dateOnly = z.string().refine(isValidYmd, "Enter a valid date (YYYY-MM-DD).");

const currency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
);

/** Signed money magnitude, non-zero (the ledger CHECK forbids `amount = 0`). */
const signedAmount = z.coerce
  .number({ invalid_type_error: "Enter an amount." })
  .refine((n) => Number.isFinite(n), "Enter an amount.")
  .refine((n) => Math.abs(n) >= 0.01, "Amount can't be zero.")
  .refine((n) => Math.abs(n) <= 9_999_999_999.99, "That amount is too large.");

const postEntrySchema = z.object({
  payee_type: z.enum(["model", "operator"], {
    errorMap: () => ({ message: "Choose a payee." }),
  }),
  payee_id: z.string().uuid("Choose a payee."),
  entry_type: z.enum(["adjustment", "deduction"], {
    errorMap: () => ({ message: "Choose an entry type." }),
  }),
  amount: signedAmount,
  currency,
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(500, "Keep the note under 500 characters.").nullable().optional(),
  ),
});

const closePeriodSchema = z
  .object({ period_start: dateOnly, period_end: dateOnly })
  .refine((d) => d.period_end >= d.period_start, {
    message: "The period end must be on or after the period start.",
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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

function describeDbError(code: string | undefined): string {
  if (code === "23514") {
    return "That posting breaks a database rule — a ledger amount can never be zero.";
  }
  if (code === "23503") {
    return "A referenced record no longer exists. Refresh and try again.";
  }
  if (code === "P0001" || code === "23P01") {
    return "That payee could not be validated. Refresh the payee list and try again.";
  }
  if (code === "42501") {
    return "You are not authorized to post to the ledger.";
  }
  return "Could not post the ledger entry. Please try again.";
}

/* -------------------------------------------------------------- post entry --- */

export async function postLedgerEntry(input: PostLedgerEntryInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "finance");

  const parsed = postEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describeDbError(error?.code) };
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
        data.entry_type === "deduction" ? "Deduction posted." : "Adjustment posted.",
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to post to the ledger." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------- close period --- */

export async function closePeriod(input: ClosePeriodInput): Promise<ClosePeriodResult> {
  const { supabase } = await requireRole("super_admin", "finance");

  const parsed = closePeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const { period_start, period_end } = parsed.data;

  try {
    const { data, error } = await supabase.rpc("fn_generate_earning_shares", {
      p_period_start: period_start,
      p_period_end: period_end,
    });

    if (error) {
      if (error.code === "42501") {
        return { ok: false, error: "You are not authorized to close periods." };
      }
      return { ok: false, error: "Could not close the period. Please try again." };
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
      message: `${posted} share${posted === 1 ? "" : "s"} posted, ${skipped} skipped.`,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to close periods." };
    }
    return { ok: false, error: "Something went wrong running share generation." };
  }
}
