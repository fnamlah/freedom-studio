"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import {
  assignmentFields,
  endAfterStart,
  endAfterStartMessage,
  operatorProfileFields,
  type AssignmentMessages,
  type OperatorMessages,
} from "@/lib/fields/operators";
import { describeDbError, firstIssue, type SqlStateMessages } from "@/lib/forms";

/**
 * Operators + operator-assignments mutations — Super Admin + Manager only
 * (docs/03 §3, docs/04 §7.2: `operators` and `operator_assignments` are CRUD for
 * SA/MGR, deny/read-own for everyone else).
 *
 * Every action opens with `requireRole("super_admin", "manager")`, which redirects
 * an unauthorized caller before any work runs. Writes go through the caller's own
 * RLS-scoped client, so RLS is the final authority on every row. Each mutation
 * appends an `audit_log` row via `writeAudit()` with a dotted-verb action
 * (docs/04 §4.16).
 *
 * `legal_name` and `payment_details` are sensitive columns (docs/04 §4.3); they
 * are only reachable here because this whole route is gated to SA/MGR.
 *
 * The two hard cross-row rules on `operator_assignments` live in the DATABASE and
 * are the authority — we only translate their errors into friendly toasts:
 *   • per-model pool_share sum ≤ 100 on every date  → `check_operator_pool` trigger
 *   • no overlapping (operator, model) windows       → EXCLUDE USING gist (23P01)
 *
 * Schemas are FACTORIES taking the caller's dictionary: a module-scope schema is
 * built at import time, where no locale exists, so its messages could only ever be
 * English. The language comes off the profile `requireRole()` already loaded.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const OPERATOR_STATUSES = ["active", "inactive", "on_leave", "terminated"] as const;
type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

/* -------------------------------------------------------------- validation --- */

/**
 * The rules live in `src/lib/fields/operators.ts`, shared with the Telegram
 * bot's write path. They used to live here as private factories, which meant
 * the bot could not reuse them and enforced almost nothing — `operators` has
 * no CHECK constraints, so nothing downstream caught it either. Messages are
 * still this module's, in the caller's language; only the rules are shared.
 */
const operatorMessages = (d: Dictionary): OperatorMessages => ({
  displayNameRequired: d.studio.operators.errDisplayNameRequired,
  legalNameRequired: d.studio.operators.errLegalNameRequired,
  email: d.studio.operators.errEmail,
  phoneLong: d.studio.operators.errPhoneLong,
  country: d.studio.operators.errCountry,
  dateInvalid: d.studio.operators.errDateInvalid,
  notesLong: d.studio.operators.errNotesLong,
  telegramUsername: d.studio.operators.errTelegramUsername,
});

const assignmentMessages = (d: Dictionary): AssignmentMessages => ({
  poolShareType: d.studio.operators.errPoolShareType,
  poolShareMin: d.studio.operators.errPoolShareMin,
  poolShareMax: d.studio.operators.errPoolShareMax,
  modelRequired: d.studio.operators.errModelRequired,
  startDateInvalid: d.studio.operators.errStartDateInvalid,
  endDateInvalid: d.studio.operators.errEndDateInvalid,
  endAfterStart: d.studio.operators.errEndAfterStart,
  notesLong: d.studio.operators.errNotesLong,
});

const profileFields = (d: Dictionary) => operatorProfileFields(operatorMessages(d));

const createOperatorSchema = (d: Dictionary) =>
  z.object({
    ...profileFields(d),
    status: z.enum(OPERATOR_STATUSES),
  });

const updateOperatorSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(),
    ...profileFields(d),
  });

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(OPERATOR_STATUSES),
});

/* ------------------------------------------------------------ assignment IO --- */

const assignmentBase = (d: Dictionary) => ({
  operator_id: z.string().uuid(),
  model_id: z.string().uuid(d.studio.operators.errModelRequired),
  ...assignmentFields(assignmentMessages(d)),
});

const createAssignmentSchema = (d: Dictionary) =>
  z.object(assignmentBase(d)).refine(endAfterStart, endAfterStartMessage(assignmentMessages(d)));

const updateAssignmentSchema = (d: Dictionary) =>
  z
    .object({ id: z.string().uuid(), ...assignmentBase(d) })
    .refine(endAfterStart, endAfterStartMessage(assignmentMessages(d)));

const deleteAssignmentSchema = z.object({
  id: z.string().uuid(),
  operator_id: z.string().uuid(),
});

/* ------------------------------------------------------------------ types --- */

export type CreateOperatorInput = {
  display_name: string;
  staff_role?: "operator" | "coach" | "team_leader";
  legal_name: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  start_date?: string | null;
  notes?: string | null;
  telegram_username?: string | null;
  status: string;
};

export type UpdateOperatorInput = Omit<CreateOperatorInput, "status"> & { id: string };

export type CreateAssignmentInput = {
  operator_id: string;
  model_id: string;
  pool_share_percent: string | number;
  assigned_from: string;
  assigned_to?: string | null;
  notes?: string | null;
};

export type UpdateAssignmentInput = CreateAssignmentInput & { id: string };

/* ---------------------------------------------------------------- helpers --- */

/**
 * Translates the assignment write errors the DB raises into friendly toasts. The
 * database is the authority; these are only human-readable renderings.
 *
 * We match on both SQLSTATE and message text so the translation is robust
 * regardless of exactly how the migration author coded the trigger:
 *   • 23P01 — EXCLUDE USING gist overlap (docs/04 §4.8)
 *   • P0001 — RAISE EXCEPTION from `check_operator_pool` (the pool-sum rule)
 *   • 23514 — CHECK (pool_share 0–100, assigned_to > assigned_from)
 *   • 23503 — FK: operator or model no longer exists
 */
function describeAssignmentError(
  error: { code?: string; message?: string } | null,
  d: Dictionary,
): string {
  const code = error?.code;
  const message = (error?.message ?? "").toLowerCase();

  if (code === "23P01" || message.includes("overlap")) {
    return d.studio.operators.errOverlap;
  }
  if (
    code === "P0001" ||
    message.includes("pool") ||
    (message.includes("100") && message.includes("exceed")) ||
    message.includes("exceeds 100")
  ) {
    return d.studio.operators.errPoolExceeded;
  }
  if (code === "23514") {
    return d.studio.operators.errAssignmentCheck;
  }
  if (code === "23503") {
    return d.studio.operators.errAssignmentFk;
  }
  return d.studio.operators.errAssignmentSaveFailed;
}

/* -------------------------------------------------------- operator: create --- */

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
function dbMessages(d: Dictionary): SqlStateMessages {
  return { "23514": d.studio.operators.errDbCheck, "23505": d.studio.operators.errDuplicate };
}

export async function createOperator(input: CreateOperatorInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createOperatorSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.operators.errForm) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("operators")
      .insert({
        display_name: data.display_name,
        staff_role: data.staff_role,
        legal_name: data.legal_name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        notes: data.notes ?? null,
        telegram_username: data.telegram_username ?? null,
        status: data.status as OperatorStatus,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeDbError(error?.code, dbMessages(d), d.studio.operators.errSaveFailed) };
    }

    await writeAudit({
      action: "operator.create",
      entityType: "operator",
      entityId: created.id,
      metadata: { display_name: data.display_name, staff_role: data.staff_role, status: data.status },
    });

    revalidatePath("/operators");
    return { ok: true, message: d.studio.operators.msgAdded(data.display_name) };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedAdd };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* -------------------------------------------------------- operator: update --- */

export async function updateOperator(input: UpdateOperatorInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateOperatorSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.operators.errForm) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("operators")
      .update({
        display_name: data.display_name,
        staff_role: data.staff_role,
        legal_name: data.legal_name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        notes: data.notes ?? null,
        telegram_username: data.telegram_username ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeDbError(error.code, dbMessages(d), d.studio.operators.errSaveFailed) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.operators.errGone };
    }

    await writeAudit({
      action: "operator.update",
      entityType: "operator",
      entityId: data.id,
      metadata: { display_name: data.display_name, staff_role: data.staff_role },
    });

    revalidatePath("/operators");
    revalidatePath(`/operators/${data.id}`);
    return { ok: true, message: d.studio.operators.msgUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedEdit };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------- operator: set status --- */

export async function setOperatorStatus(input: {
  id: string;
  status: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.operators.errInvalidStatus };
  }
  const { id, status } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("operators")
      .select("id, display_name, status")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.studio.operators.errLoadFailed };
    }
    if (!current) {
      return { ok: false, error: d.studio.operators.errGone };
    }
    if (current.status === status) {
      return {
        ok: false,
        error: d.studio.operators.msgAlreadyStatus(d.studio.lifecycleStatus[status]),
      };
    }

    const { error: updateError } = await supabase
      .from("operators")
      .update({ status })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: d.studio.operators.errStatusFailed };
    }

    await writeAudit({
      action: "operator.status_change",
      entityType: "operator",
      entityId: id,
      metadata: { display_name: current.display_name, from: current.status, to: status },
    });

    revalidatePath("/operators");
    revalidatePath(`/operators/${id}`);
    return {
      ok: true,
      message: d.studio.operators.msgStatusChanged(
        current.display_name,
        d.studio.lifecycleStatus[status],
      ),
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedStatus };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------ assignment: create --- */

export async function createAssignment(input: CreateAssignmentInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createAssignmentSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.operators.errForm) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("operator_assignments")
      .insert({
        operator_id: data.operator_id,
        model_id: data.model_id,
        pool_share_percent: data.pool_share_percent,
        assigned_from: data.assigned_from,
        assigned_to: data.assigned_to ?? null,
        notes: data.notes ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeAssignmentError(error, d) };
    }

    await writeAudit({
      action: "operator.assign",
      entityType: "operator_assignment",
      entityId: created.id,
      metadata: {
        operator_id: data.operator_id,
        model_id: data.model_id,
        pool_share_percent: data.pool_share_percent,
        assigned_from: data.assigned_from,
        assigned_to: data.assigned_to ?? null,
      },
    });

    revalidatePath(`/operators/${data.operator_id}`);
    return { ok: true, message: d.studio.operators.msgAssignmentCreated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedAssign };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------ assignment: update --- */

export async function updateAssignment(input: UpdateAssignmentInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateAssignmentSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.studio.operators.errForm) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("operator_assignments")
      .update({
        model_id: data.model_id,
        pool_share_percent: data.pool_share_percent,
        assigned_from: data.assigned_from,
        assigned_to: data.assigned_to ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .eq("operator_id", data.operator_id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeAssignmentError(error, d) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.operators.errAssignmentGone };
    }

    await writeAudit({
      action: "operator.assignment_update",
      entityType: "operator_assignment",
      entityId: data.id,
      metadata: {
        operator_id: data.operator_id,
        model_id: data.model_id,
        pool_share_percent: data.pool_share_percent,
        assigned_from: data.assigned_from,
        assigned_to: data.assigned_to ?? null,
      },
    });

    revalidatePath(`/operators/${data.operator_id}`);
    return { ok: true, message: d.studio.operators.msgAssignmentUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedAssignEdit };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------ assignment: delete --- */

export async function deleteAssignment(input: {
  id: string;
  operator_id: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = deleteAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.operators.errAssignmentInvalid };
  }
  const { id, operator_id } = parsed.data;

  try {
    const { data: deleted, error } = await supabase
      .from("operator_assignments")
      .delete()
      .eq("id", id)
      .eq("operator_id", operator_id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: d.studio.operators.errAssignmentRemoveFailed };
    }
    if (!deleted) {
      return { ok: false, error: d.studio.operators.errAssignmentGone };
    }

    await writeAudit({
      action: "operator.assignment_delete",
      entityType: "operator_assignment",
      entityId: id,
      metadata: { operator_id },
    });

    revalidatePath(`/operators/${operator_id}`);
    return { ok: true, message: d.studio.operators.msgAssignmentRemoved };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.operators.errNotAuthorizedAssignRemove };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
