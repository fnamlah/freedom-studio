"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import { describeDbError, firstIssue } from "@/lib/forms";

import {
  earningDbMessages,
  earningFields,
  periodOrdered,
  periodOrderedMessage,
} from "./earning-fields";

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
 *
 * Schemas are FACTORIES taking the caller's dictionary: a module-scope schema is
 * built at import time, where no locale exists, so its messages could only ever be
 * English. The language comes off the profile `requireRole()` already loaded.
 *
 * The `USD` currency default is data, not display — it is the column default and
 * stays untranslated in every locale.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/* -------------------------------------------------------------- validation --- */

const createSchema = (d: Dictionary) =>
  z.object(earningFields(d)).refine(periodOrdered, periodOrderedMessage(d));
const updateSchema = (d: Dictionary) =>
  z
    .object({ id: z.string().uuid(), ...earningFields(d) })
    .refine(periodOrdered, periodOrderedMessage(d));
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

/**
 * Resolves the model that owns a platform account. The result becomes the row's
 * denormalized `model_id`, so it always matches the account's owner (docs/04 §4.7).
 */
async function resolveAccountModel(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  platformAccountId: string,
  d: Dictionary,
): Promise<{ ok: true; modelId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("platform_accounts")
    .select("id, model_id")
    .eq("id", platformAccountId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: d.studio.earnings.errVerifyAccount };
  }
  if (!data) {
    return { ok: false, error: d.studio.earnings.errAccountFk };
  }
  return { ok: true, modelId: data.model_id };
}

/* ------------------------------------------------------------------ create --- */

export async function createEarning(input: EarningInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.earnings.errForm) };
  }
  const data = parsed.data;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id, d);
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
      return { ok: false, error: describeDbError(error?.code, earningDbMessages(d), d.studio.earnings.errSaveFailed) };
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
    return { ok: true, message: d.studio.earnings.msgRecorded };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.earnings.errNotAuthorizedRecord };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateEarning(input: UpdateEarningInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.earnings.errForm) };
  }
  const data = parsed.data;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id, d);
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
      return { ok: false, error: describeDbError(error.code, earningDbMessages(d), d.studio.earnings.errSaveFailed) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.earnings.errGone };
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
    return { ok: true, message: d.studio.earnings.msgUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.earnings.errNotAuthorizedEdit };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ delete --- */

export async function deleteEarning(input: { id: string }): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.earnings.errInvalid };
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
      return { ok: false, error: d.studio.earnings.errDeleteFailed };
    }
    if (!deleted) {
      return { ok: false, error: d.studio.earnings.errGone };
    }

    await writeAudit({
      action: "earning.delete",
      entityType: "earning",
      entityId: id,
      metadata: { model_id: deleted.model_id },
    });

    revalidatePath("/earnings");
    revalidatePath(`/models/${deleted.model_id}`);
    return { ok: true, message: d.studio.earnings.msgDeleted };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.earnings.errNotAuthorizedDelete };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
