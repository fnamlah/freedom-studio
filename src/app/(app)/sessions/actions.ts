"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
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
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/* -------------------------------------------------------------- validation --- */

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** `datetime-local` inputs produce `YYYY-MM-DDThh:mm` (seconds optional). */
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const datetimeLocal = z
  .string()
  .regex(DATETIME_LOCAL, "Enter a valid date and time.");

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

const grossEarnings = z.coerce
  .number({ invalid_type_error: "Enter the gross earnings." })
  .min(0, "Gross earnings can't be negative.")
  .max(9_999_999_999.99, "That amount is too large.");

const currency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : "USD"),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD."),
);

const optionalNotes = z
  .preprocess(emptyToNull, z.string().trim().max(4000, "Notes are too long.").nullable())
  .optional();

const sessionFields = {
  platform_account_id: z.string().uuid("Choose a platform account."),
  started_at: datetimeLocal,
  ended_at: z.preprocess(emptyToNull, datetimeLocal.nullable()).optional(),
  gross_earnings: grossEarnings,
  currency,
  notes: optionalNotes,
};

const createSchema = z.object(sessionFields);
const updateSchema = z.object({ id: z.string().uuid(), ...sessionFields });
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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/** Maps a Postgres error to a friendly message; DB constraints back-stop zod. */
function describeDbError(code: string | undefined): string {
  if (code === "23514") {
    return "That doesn't satisfy a database rule — the end time must be after the start time and gross earnings can't be negative.";
  }
  if (code === "23503") {
    return "That platform account no longer exists. Refresh and try again.";
  }
  return "Could not save the session. Please try again.";
}

/**
 * Resolves the model that owns a platform account. The result becomes the
 * session's denormalized `model_id`, so it always matches the account's owner.
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

/** Shared time normalization + ordering guard. */
function normalizeTimes(
  startedLocal: string,
  endedLocal: string | null | undefined,
): { ok: true; startedAt: string; endedAt: string | null } | { ok: false; error: string } {
  const startedAt = localToIsoUtc(startedLocal);
  if (!startedAt) {
    return { ok: false, error: "Enter a valid start date and time." };
  }
  let endedAt: string | null = null;
  if (endedLocal) {
    endedAt = localToIsoUtc(endedLocal);
    if (!endedAt) {
      return { ok: false, error: "Enter a valid end date and time." };
    }
    if (new Date(endedAt).getTime() <= new Date(startedAt).getTime()) {
      return { ok: false, error: "The end time must be after the start time." };
    }
  }
  return { ok: true, startedAt, endedAt };
}

/* ------------------------------------------------------------------ create --- */

export async function createSession(input: SessionInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  const times = normalizeTimes(data.started_at, data.ended_at);
  if (!times.ok) return times;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id);
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
      return { ok: false, error: describeDbError(error?.code) };
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
    return { ok: true, message: times.endedAt ? "Session logged." : "Open session started." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to log sessions." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateSession(input: UpdateSessionInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  const times = normalizeTimes(data.started_at, data.ended_at);
  if (!times.ok) return times;

  try {
    const owner = await resolveAccountModel(supabase, data.platform_account_id);
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
      return { ok: false, error: describeDbError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That session no longer exists." };
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
    return { ok: true, message: "Session updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit sessions." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ delete --- */

export async function deleteSession(input: { id: string }): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid session." };
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
      return { ok: false, error: "Could not delete the session. Please try again." };
    }
    if (!deleted) {
      return { ok: false, error: "That session no longer exists." };
    }

    await writeAudit({
      action: "session.delete",
      entityType: "work_session",
      entityId: id,
    });

    revalidatePath("/sessions");
    return { ok: true, message: "Session deleted." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to delete sessions." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
