"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Earnings mutations — Super Admin + Manager only (docs/03 §3, docs/04 §7.2:
 * `earnings` is CRUD for SA/MGR, read-own for models, read-all for finance, deny
 * for operators).
 *
 * `earnings` is the MONEY source of truth (docs/04 §4.7): one row per platform
 * statement period per account. `net_amount` — what the studio actually received —
 * is the input to the commission split (docs/09).
 *
 * Every action opens with `requireRole("super_admin", "manager")`, which redirects
 * an unauthorized caller before any work runs. Writes go through the caller's own
 * RLS-scoped client, so RLS is the final authority. Each mutation appends an
 * `audit_log` row via `writeAudit()` with a dotted-verb action (docs/04 §4.16).
 *
 * The database owns the hard rules; we only translate their errors:
 *   • UNIQUE (platform_account_id, period_start, period_end) → 23505, surfaced as a
 *     friendly "statement already exists" message.
 *   • CHECK `period_end >= period_start` and CHECK `gross_amount >= 0` → 23514.
 *
 * `model_id` is denormalized onto the row (docs/04 §4.7) and derived server-side
 * from the chosen account, so it always matches the account's owner.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/* -------------------------------------------------------------- validation --- */

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

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

const money2 = z.coerce
  .number({ invalid_type_error: "Enter an amount." })
  .min(0, "Amount can't be negative.")
  .max(9_999_999_999.99, "That amount is too large.");

/** Optional money field that defaults to 0 (matches `platform_fee_amount` default). */
const money2OrZero = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : v),
  money2,
);

const currency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
);

const earningFields = {
  platform_account_id: z.string().uuid("Choose a platform account."),
  period_start: dateOnly,
  period_end: dateOnly,
  gross_amount: money2,
  platform_fee_amount: money2OrZero,
  net_amount: money2,
  currency,
};

const periodOrdered = (data: { period_start: string; period_end: string }) =>
  data.period_end >= data.period_start;
const periodOrderedMessage = {
  message: "The period end must be on or after the period start.",
  path: ["period_end"],
};

const createSchema = z.object(earningFields).refine(periodOrdered, periodOrderedMessage);
const updateSchema = z
  .object({ id: z.string().uuid(), ...earningFields })
  .refine(periodOrdered, periodOrderedMessage);
const deleteSchema = z.object({ id: z.string().uuid() });

/* ------------------------------------------------------------------ types --- */

export type EarningInput = {
  platform_account_id: string;
  period_start: string;
  period_end: string;
  gross_amount: string | number;
  platform_fee_amount?: string | number | null;
  net_amount: string | number;
  currency?: string;
};

export type UpdateEarningInput = EarningInput & { id: string };

/* ---------------------------------------------------------------- helpers --- */

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/**
 * Maps a Postgres error to a friendly message. The unique-violation is the one the
 * brief calls out: each account can hold only one statement per period.
 */
function describeDbError(code: string | undefined): string {
  if (code === "23505") {
    return "A statement already exists for this account and period. Each platform account can have only one earnings row per statement period — edit the existing one instead.";
  }
  if (code === "23514") {
    return "That doesn't satisfy a database rule — the period end must be on or after the start, and amounts can't be negative.";
  }
  if (code === "23503") {
    return "That platform account no longer exists. Refresh and try again.";
  }
  return "Could not save the earnings statement. Please try again.";
}

/**
 * Resolves the model that owns a platform account. The result becomes the row's
 * denormalized `model_id`, so it always matches the account's owner (docs/04 §4.7).
 */
async function resolveAccountModel(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  platformAccountId: string,
): Promise<{ ok: true; modelId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("platform_accounts")
    .select("id, model_id")
    .eq("id", platformAccountId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: "Could not verify the platform account. Please try again." };
  }
  if (!data) {
    return { ok: false, error: "That platform account no longer exists. Refresh and try again." };
  }
  return { ok: true, modelId: data.model_id };
}

/* ------------------------------------------------------------------ create --- */

export async function createEarning(input: EarningInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id);
    if (!owner.ok) return owner;

    const { data: created, error } = await supabase
      .from("earnings")
      .insert({
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        period_start: data.period_start,
        period_end: data.period_end,
        gross_amount: data.gross_amount,
        platform_fee_amount: data.platform_fee_amount,
        net_amount: data.net_amount,
        currency: data.currency,
        entered_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code) };
    }

    await writeAudit({
      action: "earning.create",
      entityType: "earning",
      entityId: created.id,
      metadata: {
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        period_start: data.period_start,
        period_end: data.period_end,
        net_amount: data.net_amount,
      },
    });

    revalidatePath("/earnings");
    revalidatePath(`/models/${owner.modelId}`);
    return { ok: true, message: "Statement recorded." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to record earnings." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateEarning(input: UpdateEarningInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id);
    if (!owner.ok) return owner;

    const { data: updated, error } = await supabase
      .from("earnings")
      .update({
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        period_start: data.period_start,
        period_end: data.period_end,
        gross_amount: data.gross_amount,
        platform_fee_amount: data.platform_fee_amount,
        net_amount: data.net_amount,
        currency: data.currency,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That statement no longer exists." };
    }

    await writeAudit({
      action: "earning.update",
      entityType: "earning",
      entityId: data.id,
      metadata: {
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        period_start: data.period_start,
        period_end: data.period_end,
        net_amount: data.net_amount,
      },
    });

    revalidatePath("/earnings");
    revalidatePath(`/models/${owner.modelId}`);
    return { ok: true, message: "Statement updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit earnings." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ delete --- */

export async function deleteEarning(input: { id: string }): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid statement." };
  }
  const { id } = parsed.data;

  try {
    const { data: deleted, error } = await supabase
      .from("earnings")
      .delete()
      .eq("id", id)
      .select("id, model_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: "Could not delete the statement. Please try again." };
    }
    if (!deleted) {
      return { ok: false, error: "That statement no longer exists." };
    }

    await writeAudit({
      action: "earning.delete",
      entityType: "earning",
      entityId: id,
      metadata: { model_id: deleted.model_id },
    });

    revalidatePath("/earnings");
    revalidatePath(`/models/${deleted.model_id}`);
    return { ok: true, message: "Statement deleted." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to delete earnings." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
