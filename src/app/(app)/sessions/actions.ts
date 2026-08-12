"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

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

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** `datetime-local` inputs produce `YYYY-MM-DDThh:mm` (seconds optional). */
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const datetimeLocal = (d: Dictionary) =>
  z.string().regex(DATETIME_LOCAL, d.studio.sessions.errDatetime);

/**
 * Converts a `datetime-local` value to a UTC ISO string. The whole app displays
 * dates in UTC (see `@/lib/format`), so we interpret the wall-clock value the user
 * typed as UTC too — that round-trips exactly with the formatters. Returns null on
 * an impossible calendar datetime (e.g. Feb 30), which the caller turns into a
 * friendly error.
 */
function localToIsoUtc(value: string): string | null {
  const m = DATETIME_LOCAL.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi
  ) {
    return null;
  }
  return dt.toISOString();
}

const grossEarnings = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.studio.sessions.errGrossType })
    .min(0, d.studio.sessions.errGrossMin)
    .max(9_999_999_999.99, d.studio.sessions.errAmountTooLarge);

const currency = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
    z.string().regex(/^[A-Z]{3}$/, d.studio.sessions.errCurrency),
  );

const optionalNotes = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().max(4000, d.studio.sessions.errNotesLong).nullable(),
    )
    .optional();

const sessionFields = (d: Dictionary) => ({
  platform_account_id: z.string().uuid(d.studio.sessions.errAccountRequired),
  started_at: datetimeLocal(d),
  ended_at: z.preprocess(emptyToNull, datetimeLocal(d).nullable()).optional(),
  gross_earnings: grossEarnings(d),
  currency: currency(d),
  notes: optionalNotes(d),
});

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

function firstIssue(error: z.ZodError, d: Dictionary): string {
  return error.issues[0]?.message ?? d.studio.sessions.errForm;
}

/** Maps a Postgres error to a friendly message; DB constraints back-stop zod. */
function describeDbError(code: string | undefined, d: Dictionary): string {
  if (code === "23514") {
    return d.studio.sessions.errDbCheck;
  }
  if (code === "23503") {
    return d.studio.sessions.errAccountFk;
  }
  return d.studio.sessions.errSaveFailed;
}

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

/** Shared time normalization + ordering guard. */
function normalizeTimes(
  startedLocal: string,
  endedLocal: string | null | undefined,
  d: Dictionary,
): { ok: true; startedAt: string; endedAt: string | null } | { ok: false; error: string } {
  const startedAt = localToIsoUtc(startedLocal);
  if (!startedAt) {
    return { ok: false, error: d.studio.sessions.errStartInvalid };
  }
  let endedAt: string | null = null;
  if (endedLocal) {
    endedAt = localToIsoUtc(endedLocal);
    if (!endedAt) {
      return { ok: false, error: d.studio.sessions.errEndInvalid };
    }
    if (new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
      return { ok: false, error: d.studio.sessions.errEndAfterStart };
    }
  }
  return { ok: true, startedAt, endedAt };
}

/* ------------------------------------------------------------------ create --- */

export async function createSession(input: SessionInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
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
      return { ok: false, error: describeDbError(error?.code, d) };
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
    return { ok: false, error: firstIssue(parsed.error, d) };
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
      return { ok: false, error: describeDbError(error.code, d) };
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
