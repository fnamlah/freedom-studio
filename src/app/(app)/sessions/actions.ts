"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import { describeDbError, firstIssue } from "@/lib/forms";

import { normalizeTimes, sessionDbMessages, sessionFields } from "./session-fields";

/**
 * Work-sessions mutations — Super Admin + Manager only (docs/03 §3, docs/04 §7.2:
 * `work_sessions` is CRUD for SA/MGR, read-own for models, read-all for finance,
 * deny for operators).
 *
 * `work_sessions` is the HOURS source of truth (docs/04 §4.6): time is tracked
 * here, money lives in `earnings`. Per-session `gross_earnings` is recorded when
 * known, but it is NOT what accounting consumes.
 *
 * Every action opens with `requireRole("super_admin", "manager")`, which redirects
 * an unauthorized caller before any work runs. Writes go through the caller's own
 * RLS-scoped client, so RLS is the final authority on every row. Each mutation
 * appends an `audit_log` row via `writeAudit()` with a dotted-verb action
 * (docs/04 §4.16).
 *
 * Two facts the database owns and we only translate:
 *   • `duration_minutes` is `GENERATED ALWAYS AS STORED` — never written here.
 *   • CHECK `ended_at > started_at` and CHECK `gross_earnings >= 0` back-stop the
 *     zod validation below (the DB is the last word).
 *
 * `model_id` is denormalized onto the session (docs/04 §4.6) so the model's
 * own-rows RLS policy stays a single-hop comparison. We derive it server-side from
 * the chosen platform account rather than trusting a client-supplied value, so the
 * denormalized copy can never drift from the account's true owner.
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

const createSchema = (d: Dictionary) => z.object(sessionFields(d));
const updateSchema = (d: Dictionary) =>
  z.object({ id: z.string().uuid(), ...sessionFields(d) });
const deleteSchema = z.object({ id: z.string().uuid() });

/* ------------------------------------------------------------------ types --- */

export type SessionInput = {
  platform_account_id: string;
  started_at: string;
  ended_at?: string | null;
  gross_earnings: string | number;
  currency?: string;
  notes?: string | null;
};

export type UpdateSessionInput = SessionInput & { id: string };

/* ---------------------------------------------------------------- helpers --- */

/**
 * Resolves the model that owns a platform account. The result becomes the
 * session's denormalized `model_id`, so it always matches the account's owner.
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
    return { ok: false, error: d.studio.sessions.errVerifyAccount };
  }
  if (!data) {
    return { ok: false, error: d.studio.sessions.errAccountFk };
  }
  return { ok: true, modelId: data.model_id };
}

/* ------------------------------------------------------------------ create --- */

export async function createSession(input: SessionInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.sessions.errForm) };
  }
  const data = parsed.data;

  const times = normalizeTimes(data.started_at, data.ended_at, d);
  if (!times.ok) return times;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id, d);
    if (!owner.ok) return owner;

    const { data: created, error } = await supabase
      .from("work_sessions")
      .insert({
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        started_at: times.startedAt,
        ended_at: times.endedAt,
        gross_earnings: data.gross_earnings,
        currency: data.currency,
        notes: data.notes ?? null,
        entered_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code, sessionDbMessages(d), d.studio.sessions.errSaveFailed) };
    }

    await writeAudit({
      action: "session.create",
      entityType: "work_session",
      entityId: created.id,
      metadata: {
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        started_at: times.startedAt,
        ended_at: times.endedAt,
        gross_earnings: data.gross_earnings,
      },
    });

    revalidatePath("/sessions");
    return {
      ok: true,
      message: times.endedAt
        ? d.studio.sessions.msgLogged
        : d.studio.sessions.msgOpenStarted,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.sessions.errNotAuthorizedLog };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateSession(input: UpdateSessionInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.sessions.errForm) };
  }
  const data = parsed.data;

  const times = normalizeTimes(data.started_at, data.ended_at, d);
  if (!times.ok) return times;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id, d);
    if (!owner.ok) return owner;

    const { data: updated, error } = await supabase
      .from("work_sessions")
      .update({
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        started_at: times.startedAt,
        ended_at: times.endedAt,
        gross_earnings: data.gross_earnings,
        currency: data.currency,
        notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code, sessionDbMessages(d), d.studio.sessions.errSaveFailed) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.sessions.errGone };
    }

    await writeAudit({
      action: "session.update",
      entityType: "work_session",
      entityId: data.id,
      metadata: {
        model_id: owner.modelId,
        platform_account_id: data.platform_account_id,
        started_at: times.startedAt,
        ended_at: times.endedAt,
        gross_earnings: data.gross_earnings,
      },
    });

    revalidatePath("/sessions");
    return { ok: true, message: d.studio.sessions.msgUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.sessions.errNotAuthorizedEdit };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ delete --- */

export async function deleteSession(input: { id: string }): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.sessions.errInvalid };
  }
  const { id } = parsed.data;

  try {
    const { data: deleted, error } = await supabase
      .from("work_sessions")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: d.studio.sessions.errDeleteFailed };
    }
    if (!deleted) {
      return { ok: false, error: d.studio.sessions.errGone };
    }

    await writeAudit({
      action: "session.delete",
      entityType: "work_session",
      entityId: id,
    });

    revalidatePath("/sessions");
    return { ok: true, message: d.studio.sessions.msgDeleted };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.sessions.errNotAuthorizedDelete };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
