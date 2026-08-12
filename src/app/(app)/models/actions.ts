"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Models CRUD — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * Every action opens with `requireRole("super_admin", "manager")`, which redirects
 * an unauthorized caller BEFORE any work runs (the guard is the hard gate). Writes
 * go through the caller's own RLS-scoped client — SA/MGR hold full CRUD on `models`
 * — so RLS is the final authority on every row. Each mutation appends an
 * `audit_log` row via `writeAudit()` with a dotted-verb action (docs/04 §4.16).
 *
 * `legal_name` and `date_of_birth` are sensitive columns (docs/04 §4.2). They are
 * only ever written/read here because this whole route is gated to SA/MGR, the
 * sole readers of those columns.
 *
 * The 18+ age gate is enforced twice: in the zod schema below (fast, friendly
 * message) and by the `date_of_birth <= current_date - interval '18 years'` CHECK
 * constraint on the table (authoritative — the DB is the last word).
 *
 * Every schema is a FACTORY taking the caller's dictionary: a module-scope schema
 * is built at import time, where no locale exists, so its messages could only ever
 * be English. The caller's language comes off the profile `requireRole()` already
 * loaded — no second lookup.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const MODEL_STATUSES = ["active", "inactive", "on_leave", "terminated"] as const;
type ModelStatus = (typeof MODEL_STATUSES)[number];

/* -------------------------------------------------------------- validation --- */

type Ymd = { y: number; m: number; d: number };

/** Parses a strict `YYYY-MM-DD` and rejects impossible calendar dates. */
function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (
    asDate.getUTCFullYear() !== y ||
    asDate.getUTCMonth() !== m - 1 ||
    asDate.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

/** Mirrors the DB CHECK: born on or before (today − 18 years). */
function isAdult({ y, m, d }: Ymd): boolean {
  const birth = Date.UTC(y, m - 1, d);
  const now = new Date();
  const cutoff = Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate());
  return birth <= cutoff;
}

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const dateOfBirth = (d: Dictionary) =>
  z
    .string()
    .refine((v) => parseYmd(v) !== null, d.studio.models.errDobInvalid)
    .refine((v) => {
      const parsed = parseYmd(v);
      return parsed !== null && isAdult(parsed);
    }, d.studio.models.errAdult);

const optionalDate = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z
        .string()
        .refine((v) => parseYmd(v) !== null, d.studio.models.errDateInvalid)
        .nullable(),
    )
    .optional();

const optionalEmail = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().email(d.studio.models.errEmail).nullable(),
    )
    .optional();

const optionalPhone = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().max(40, d.studio.models.errPhoneLong).nullable(),
    )
    .optional();

const optionalCountry = (d: Dictionary) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null),
      z.string().regex(/^[A-Z]{2}$/, d.studio.models.errCountry).nullable(),
    )
    .optional();

const optionalNotes = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().max(4000, d.studio.models.errNotesLong).nullable(),
    )
    .optional();

const commissionPercent = (d: Dictionary) =>
  z.coerce
    .number({ invalid_type_error: d.studio.models.errCommissionType })
    .min(0, d.studio.models.errCommissionMin)
    .max(100, d.studio.models.errCommissionMax);

/** Shared profile fields (everything except lifecycle status). */
const profileFields = (d: Dictionary) => ({
  stage_name: z.string().trim().min(1, d.studio.models.errStageNameRequired).max(160),
  legal_name: z.string().trim().min(1, d.studio.models.errLegalNameRequired).max(200),
  date_of_birth: dateOfBirth(d),
  email: optionalEmail(d),
  phone: optionalPhone(d),
  country: optionalCountry(d),
  start_date: optionalDate(d),
  commission_percent: commissionPercent(d),
  notes: optionalNotes(d),
});

const createSchema = (d: Dictionary) =>
  z.object({
    ...profileFields(d),
    status: z.enum(MODEL_STATUSES),
  });

const updateSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(),
    ...profileFields(d),
  });

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(MODEL_STATUSES),
});

/* ------------------------------------------------------------------ types --- */

export type CreateModelInput = {
  stage_name: string;
  legal_name: string;
  date_of_birth: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  start_date?: string | null;
  commission_percent: string | number;
  notes?: string | null;
  status: string;
};

export type UpdateModelInput = Omit<CreateModelInput, "status"> & { id: string };

/* ---------------------------------------------------------------- helpers --- */

function firstIssue(error: z.ZodError, d: Dictionary): string {
  return error.issues[0]?.message ?? d.studio.models.errForm;
}

/** Maps a Postgres error to a friendly message; CHECK violations back-stop zod. */
function describeDbError(code: string | undefined, d: Dictionary): string {
  if (code === "23514") {
    return d.studio.models.errDbCheck;
  }
  if (code === "23505") {
    return d.studio.models.errDuplicate;
  }
  return d.studio.models.errSaveFailed;
}

/* ------------------------------------------------------------------ create --- */

export async function createModel(input: CreateModelInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("models")
      .insert({
        stage_name: data.stage_name,
        legal_name: data.legal_name,
        date_of_birth: data.date_of_birth,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        commission_percent: data.commission_percent,
        notes: data.notes ?? null,
        status: data.status as ModelStatus,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code, d) };
    }

    await writeAudit({
      action: "model.create",
      entityType: "model",
      entityId: created.id,
      metadata: { stage_name: data.stage_name, status: data.status },
    });

    revalidatePath("/models");
    return { ok: true, message: d.studio.models.msgAdded(data.stage_name) };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.models.errNotAuthorizedAdd };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateModel(input: UpdateModelInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("models")
      .update({
        stage_name: data.stage_name,
        legal_name: data.legal_name,
        date_of_birth: data.date_of_birth,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        commission_percent: data.commission_percent,
        notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code, d) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.models.errGone };
    }

    await writeAudit({
      action: "model.update",
      entityType: "model",
      entityId: data.id,
      metadata: { stage_name: data.stage_name },
    });

    revalidatePath("/models");
    revalidatePath(`/models/${data.id}`);
    return { ok: true, message: d.studio.models.msgUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.models.errNotAuthorizedEdit };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* --------------------------------------------------------------- set status --- */

export async function setModelStatus(input: {
  id: string;
  status: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.models.errInvalidStatus };
  }
  const { id, status } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("models")
      .select("id, stage_name, status")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.studio.models.errLoadFailed };
    }
    if (!current) {
      return { ok: false, error: d.studio.models.errGone };
    }
    if (current.status === status) {
      return {
        ok: false,
        error: d.studio.models.msgAlreadyStatus(d.studio.lifecycleStatus[status]),
      };
    }

    const { error: updateError } = await supabase
      .from("models")
      .update({ status })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: d.studio.models.errStatusFailed };
    }

    await writeAudit({
      action: "model.status_change",
      entityType: "model",
      entityId: id,
      metadata: { stage_name: current.stage_name, from: current.status, to: status },
    });

    revalidatePath("/models");
    revalidatePath(`/models/${id}`);
    return {
      ok: true,
      message: d.studio.models.msgStatusChanged(
        current.stage_name,
        d.studio.lifecycleStatus[status],
      ),
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.models.errNotAuthorizedStatus };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
