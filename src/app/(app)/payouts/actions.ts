"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Payout workflow — maker-checker under strict role separation (docs/09 §6,
 * docs/03 §3 "Payouts"):
 *
 *   • createPayout  — SA / MGR / FIN create a `pending` payout (finance records,
 *     manager may originate; docs/03 line 70, docs/04 §4.11 RLS: FIN/MGR/SA `C`).
 *   • approvePayout — SUPER ADMIN ONLY. Authorization is deliberately split from
 *     origination so no single insider can invent and release money (docs/03 §
 *     maker-checker, docs/08 financial-fraud). `pending → approved`.
 *   • markPayoutPaid — FIN / SA record settlement. `approved → paid`; the DB
 *     trigger then posts the negative `payout_settlement` ledger entry — the ONLY
 *     writer of settlement entries (docs/09 §6). We never post it ourselves.
 *   • cancelPayout  — before payment: `pending → cancelled` (SA/MGR/FIN) or
 *     `approved → cancelled` (SA only, since the row is no longer `pending`).
 *
 * The state machine is enforced in the database (docs/04 §7 policy notes: WITH
 * CHECK forbids finance writing `approved`, `paid` reachable only from `approved`).
 * Each action re-guards with `requireRole(...)`, writes through the caller's own
 * RLS-scoped client, and each `.eq("status", …)` pre-filter targets only the legal
 * source state so an illegal transition simply matches zero rows and is surfaced.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/* -------------------------------------------------------------- validation --- */

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

const money2 = z.coerce
  .number({ invalid_type_error: "Enter an amount." })
  .min(0, "Amount can't be negative.")
  .max(9_999_999_999.99, "That amount is too large.");

const money2OrZero = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : v),
  money2,
);

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max, `Keep this under ${max} characters.`).nullable().optional(),
  );

const createSchema = z
  .object({
    payee_type: z.enum(["model", "operator"], {
      errorMap: () => ({ message: "Choose a payee." }),
    }),
    payee_id: z.string().uuid("Choose a payee."),
    period_start: dateOnly,
    period_end: dateOnly,
    gross_amount: money2,
    studio_fee_amount: money2OrZero,
    deductions: money2OrZero,
    net_amount: money2,
    currency,
    payment_method: optionalText(120),
    notes: optionalText(1000),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "The period end must be on or after the period start.",
    path: ["period_end"],
  });

const idSchema = z.object({ id: z.string().uuid("Invalid payout.") });

const markPaidSchema = z.object({
  id: z.string().uuid("Invalid payout."),
  reference: optionalText(200),
  payment_method: optionalText(120),
});

/* ------------------------------------------------------------------ types --- */

export type CreatePayoutInput = {
  payee_type: "model" | "operator";
  payee_id: string;
  period_start: string;
  period_end: string;
  gross_amount: string | number;
  studio_fee_amount?: string | number | null;
  deductions?: string | number | null;
  net_amount: string | number;
  currency?: string;
  payment_method?: string | null;
  notes?: string | null;
};

export type MarkPaidInput = {
  id: string;
  reference?: string | null;
  payment_method?: string | null;
};

/* ---------------------------------------------------------------- helpers --- */

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

function describeDbError(code: string | undefined): string {
  if (code === "23514") {
    return "That breaks a database rule — the period end must be on or after the start, and amounts can't be negative.";
  }
  if (code === "23503" || code === "P0001") {
    return "That payee could not be validated. Refresh the payee list and try again.";
  }
  if (code === "42501") {
    return "You are not authorized for that payout action.";
  }
  return "Could not complete the payout action. Please try again.";
}

/* ------------------------------------------------------------------ create --- */

export async function createPayout(input: CreatePayoutInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager", "finance");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("payouts")
      .insert({
        payee_type: data.payee_type,
        payee_id: data.payee_id,
        period_start: data.period_start,
        period_end: data.period_end,
        gross_amount: data.gross_amount,
        studio_fee_amount: data.studio_fee_amount,
        deductions: data.deductions,
        net_amount: data.net_amount,
        currency: data.currency,
        payment_method: data.payment_method ?? null,
        notes: data.notes ?? null,
        created_by: user.id,
        // status defaults to 'pending'
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code) };
    }

    await writeAudit({
      action: "payout.create",
      entityType: "payout",
      entityId: created.id,
      metadata: {
        payee_type: data.payee_type,
        payee_id: data.payee_id,
        net_amount: data.net_amount,
        currency: data.currency,
        period_start: data.period_start,
        period_end: data.period_end,
      },
    });

    revalidatePath("/payouts");
    return { ok: true, message: "Payout created (pending approval)." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to create payouts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ----------------------------------------------------------------- approve --- */

export async function approvePayout(input: { id: string }): Promise<ActionResult> {
  // Maker-checker: ONLY the Super Admin authorizes (docs/03, docs/09 §6).
  const { supabase, user } = await requireRole("super_admin");

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid payout." };
  }

  try {
    const { data: updated, error } = await supabase
      .from("payouts")
      .update({ status: "approved", approved_by: user.id })
      .eq("id", parsed.data.id)
      .eq("status", "pending")
      .select("id, net_amount, currency, payee_type, payee_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code) };
    }
    if (!updated) {
      return {
        ok: false,
        error: "That payout can't be approved — it's no longer pending. Refresh and try again.",
      };
    }

    await writeAudit({
      action: "payout.approve",
      entityType: "payout",
      entityId: parsed.data.id,
      metadata: {
        payee_type: updated.payee_type,
        payee_id: updated.payee_id,
        net_amount: updated.net_amount,
        currency: updated.currency,
      },
    });

    revalidatePath("/payouts");
    return { ok: true, message: "Payout approved." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "Only a Super Admin can approve payouts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* -------------------------------------------------------------- mark paid --- */

export async function markPayoutPaid(input: MarkPaidInput): Promise<ActionResult> {
  const { supabase } = await requireRole("finance", "super_admin");

  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("payouts")
      .update({
        status: "paid",
        reference: data.reference ?? null,
        ...(data.payment_method ? { payment_method: data.payment_method } : {}),
        paid_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "approved")
      .select("id, net_amount, currency, payee_type, payee_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code) };
    }
    if (!updated) {
      return {
        ok: false,
        error:
          "That payout can't be marked paid — it must be approved first (and not already paid). Refresh and try again.",
      };
    }

    await writeAudit({
      action: "payout.paid",
      entityType: "payout",
      entityId: data.id,
      metadata: {
        payee_type: updated.payee_type,
        payee_id: updated.payee_id,
        net_amount: updated.net_amount,
        currency: updated.currency,
        reference: data.reference ?? null,
      },
    });

    revalidatePath("/payouts");
    revalidatePath("/ledger");
    revalidatePath("/statements");
    return { ok: true, message: "Payout marked paid — settlement posted to the ledger." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to settle payouts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ cancel --- */

export async function cancelPayout(input: { id: string }): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager", "finance");

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid payout." };
  }

  try {
    const { data: updated, error } = await supabase
      .from("payouts")
      .update({ status: "cancelled" })
      .eq("id", parsed.data.id)
      .in("status", ["pending", "approved"])
      .select("id, status, payee_type, payee_id, net_amount, currency")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code) };
    }
    if (!updated) {
      return {
        ok: false,
        error:
          "That payout can't be cancelled — it may already be paid or cancelled, or you lack permission for its current state.",
      };
    }

    await writeAudit({
      action: "payout.cancel",
      entityType: "payout",
      entityId: parsed.data.id,
      metadata: {
        payee_type: updated.payee_type,
        payee_id: updated.payee_id,
        net_amount: updated.net_amount,
        currency: updated.currency,
      },
    });

    revalidatePath("/payouts");
    return { ok: true, message: "Payout cancelled." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to cancel payouts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
