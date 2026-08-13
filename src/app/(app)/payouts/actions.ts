"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import { describeDbError, firstIssue, type SqlStateMessages } from "@/lib/forms";

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
 *
 * Every message the client can surface is resolved from the CALLER's dictionary
 * — `requireRole` already loaded their profile, so the locale costs nothing.
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

/**
 * The schemas are FACTORIES, not module constants. A module-scope `z.object` is
 * evaluated at import time — before any request, and therefore before any
 * locale — so its messages could only ever be in one language. Building the
 * schema inside the action lets every message come from the caller's dictionary.
 */
const dateOnly = (d: Dictionary) => z.string().refine(isValidYmd, d.money.payouts.errInvalidDate);

const currencyField = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.money.payouts.errCurrency),
  );

const money2 = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.money.payouts.errEnterAmount })
    .min(0, d.money.payouts.errAmountNegative)
    .max(9_999_999_999.99, d.money.payouts.errAmountTooLarge);

const money2OrZero = (d: Dictionary) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), money2(d));

const optionalText = (d: Dictionary, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max, d.money.payouts.errTextTooLong(max)).nullable().optional(),
  );

const createSchema = (d: Dictionary) =>
  z
    .object({
      payee_type: z.enum(["model", "operator"], {
        errorMap: () => ({ message: d.money.payouts.errChoosePayee }),
      }),
      payee_id: z.string().uuid(d.money.payouts.errChoosePayee),
      period_start: dateOnly(d),
      period_end: dateOnly(d),
      gross_amount: money2(d),
      studio_fee_amount: money2OrZero(d),
      deductions: money2OrZero(d),
      net_amount: money2(d),
      currency: currencyField(d),
      payment_method: optionalText(d, 120),
      notes: optionalText(d, 1000),
    })
    .refine((v) => v.period_end >= v.period_start, {
      message: d.money.payouts.errPeriodOrder,
      path: ["period_end"],
    });

const idSchema = (d: Dictionary) =>
  z.object({ id: z.string().uuid(d.money.payouts.errInvalidPayout) });

const markPaidSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(d.money.payouts.errInvalidPayout),
    reference: optionalText(d, 200),
    payment_method: optionalText(d, 120),
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

/* ------------------------------------------------------------------ create --- */

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
function dbMessages(d: Dictionary): SqlStateMessages {
  return { "23514": d.money.payouts.errDbCheck, "23503": d.money.payouts.errDbPayee, "42501": d.money.payouts.errDbForbidden };
}

export async function createPayout(input: CreatePayoutInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager", "finance");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.payouts.errCheckForm) };
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
      return { ok: false, error: describeDbError(error?.code, dbMessages(d), d.money.payouts.errDbGeneric) };
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
    return { ok: true, message: d.money.payouts.okCreated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.payouts.errNotAuthorizedCreate };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ----------------------------------------------------------------- approve --- */

export async function approvePayout(input: { id: string }): Promise<ActionResult> {
  // Maker-checker: ONLY the Super Admin authorizes (docs/03, docs/09 §6).
  const { supabase, user, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = idSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.money.payouts.errInvalidPayout };
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
      return { ok: false, error: describeDbError(error.code, dbMessages(d), d.money.payouts.errDbGeneric) };
    }
    if (!updated) {
      return { ok: false, error: d.money.payouts.errNotPending };
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
    return { ok: true, message: d.money.payouts.okApproved };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.payouts.errNotAuthorizedApprove };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* -------------------------------------------------------------- mark paid --- */

export async function markPayoutPaid(input: MarkPaidInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("finance", "super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = markPaidSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.payouts.errCheckForm) };
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
      return { ok: false, error: describeDbError(error.code, dbMessages(d), d.money.payouts.errDbGeneric) };
    }
    if (!updated) {
      return { ok: false, error: d.money.payouts.errNotApproved };
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
    return { ok: true, message: d.money.payouts.okPaid };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.payouts.errNotAuthorizedSettle };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ cancel --- */

export async function cancelPayout(input: { id: string }): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager", "finance");
  const d = dict(toLocale(profile.locale));

  const parsed = idSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.money.payouts.errInvalidPayout };
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
      return { ok: false, error: describeDbError(error.code, dbMessages(d), d.money.payouts.errDbGeneric) };
    }
    if (!updated) {
      return { ok: false, error: d.money.payouts.errNotCancellable };
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
    return { ok: true, message: d.money.payouts.okCancelled };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.payouts.errNotAuthorizedCancel };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
