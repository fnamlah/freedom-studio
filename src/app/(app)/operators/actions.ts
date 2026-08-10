"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { isAuthzError } from "@/lib/supabase/admin";

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
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const OPERATOR_STATUSES = ["active", "inactive", "on_leave", "terminated"] as const;
type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

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

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalEmail = z
  .preprocess(emptyToNull, z.string().trim().email("Enter a valid email address.").nullable())
  .optional();

const optionalPhone = z
  .preprocess(emptyToNull, z.string().trim().max(40, "Phone number is too long.").nullable())
  .optional();

const optionalCountry = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null),
    z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code.").nullable(),
  )
  .optional();

const optionalStartDate = z
  .preprocess(
    emptyToNull,
    z.string().refine(isValidYmd, "Enter a valid date (YYYY-MM-DD).").nullable(),
  )
  .optional();

const optionalNotes = z
  .preprocess(emptyToNull, z.string().trim().max(4000, "Notes are too long.").nullable())
  .optional();

/** Shared operator profile fields (everything except lifecycle status). */
const profileFields = {
  display_name: z.string().trim().min(1, "Display name is required.").max(160),
  legal_name: z.string().trim().min(1, "Legal name is required.").max(200),
  email: optionalEmail,
  phone: optionalPhone,
  country: optionalCountry,
  start_date: optionalStartDate,
  notes: optionalNotes,
};

const createOperatorSchema = z.object({
  ...profileFields,
  status: z.enum(OPERATOR_STATUSES),
});

const updateOperatorSchema = z.object({
  id: z.string().uuid(),
  ...profileFields,
});

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(OPERATOR_STATUSES),
});

/* ------------------------------------------------------------ assignment IO --- */

const poolShare = z.coerce
  .number({ invalid_type_error: "Enter a pool share." })
  .min(0, "Pool share can't be negative.")
  .max(100, "Pool share can't exceed 100%.");

const assignmentBase = {
  operator_id: z.string().uuid(),
  model_id: z.string().uuid("Choose a model."),
  pool_share_percent: poolShare,
  assigned_from: z.string().refine(isValidYmd, "Enter a valid start date (YYYY-MM-DD)."),
  assigned_to: z
    .preprocess(
      emptyToNull,
      z.string().refine(isValidYmd, "Enter a valid end date (YYYY-MM-DD).").nullable(),
    )
    .optional(),
  notes: optionalNotes,
};

/** Mirrors the DB CHECK `assigned_to > assigned_from` with a friendly message. */
const endAfterStart = (data: { assigned_from: string; assigned_to?: string | null }) =>
  !data.assigned_to || data.assigned_to > data.assigned_from;
const endAfterStartMessage = { message: "End date must be after the start date.", path: ["assigned_to"] };

const createAssignmentSchema = z.object(assignmentBase).refine(endAfterStart, endAfterStartMessage);

const updateAssignmentSchema = z
  .object({ id: z.string().uuid(), ...assignmentBase })
  .refine(endAfterStart, endAfterStartMessage);

const deleteAssignmentSchema = z.object({
  id: z.string().uuid(),
  operator_id: z.string().uuid(),
});

/* ------------------------------------------------------------------ types --- */

export type CreateOperatorInput = {
  display_name: string;
  legal_name: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  start_date?: string | null;
  notes?: string | null;
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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/** Maps a Postgres error on `operators` to a friendly message. */
function describeOperatorError(code: string | undefined): string {
  if (code === "23514") {
    return "That doesn't satisfy a database rule — check the country code.";
  }
  if (code === "23505") {
    return "An operator with those details already exists.";
  }
  return "Could not save the operator. Please try again.";
}

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
function describeAssignmentError(error: { code?: string; message?: string } | null): string {
  const code = error?.code;
  const message = (error?.message ?? "").toLowerCase();

  if (code === "23P01" || message.includes("overlap")) {
    return "This operator already has an overlapping assignment to that model. Adjust the dates so the periods don't overlap.";
  }
  if (
    code === "P0001" ||
    message.includes("pool") ||
    (message.includes("100") && message.includes("exceed")) ||
    message.includes("exceeds 100")
  ) {
    return "The model's operator pool would exceed 100% for these dates. Lower this share or shorten the period.";
  }
  if (code === "23514") {
    return "That doesn't satisfy a database rule — pool share must be 0–100% and the end date must follow the start date.";
  }
  if (code === "23503") {
    return "The operator or model no longer exists. Refresh and try again.";
  }
  return "Could not save the assignment. Please try again.";
}

/* -------------------------------------------------------- operator: create --- */

export async function createOperator(input: CreateOperatorInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = createOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("operators")
      .insert({
        display_name: data.display_name,
        legal_name: data.legal_name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        notes: data.notes ?? null,
        status: data.status as OperatorStatus,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeOperatorError(error?.code) };
    }

    await writeAudit({
      action: "operator.create",
      entityType: "operator",
      entityId: created.id,
      metadata: { display_name: data.display_name, status: data.status },
    });

    revalidatePath("/operators");
    return { ok: true, message: `${data.display_name} added.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to add operators." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* -------------------------------------------------------- operator: update --- */

export async function updateOperator(input: UpdateOperatorInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updateOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("operators")
      .update({
        display_name: data.display_name,
        legal_name: data.legal_name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        start_date: data.start_date ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeOperatorError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That operator no longer exists." };
    }

    await writeAudit({
      action: "operator.update",
      entityType: "operator",
      entityId: data.id,
      metadata: { display_name: data.display_name },
    });

    revalidatePath("/operators");
    revalidatePath(`/operators/${data.id}`);
    return { ok: true, message: "Operator updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit operators." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ---------------------------------------------------- operator: set status --- */

export async function setOperatorStatus(input: {
  id: string;
  status: string;
}): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid status change." };
  }
  const { id, status } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("operators")
      .select("id, display_name, status")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: "Could not load that operator." };
    }
    if (!current) {
      return { ok: false, error: "That operator no longer exists." };
    }
    if (current.status === status) {
      return { ok: false, error: `Operator is already ${status.replace("_", " ")}.` };
    }

    const { error: updateError } = await supabase
      .from("operators")
      .update({ status })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: "Could not change the status. Please try again." };
    }

    await writeAudit({
      action: "operator.status_change",
      entityType: "operator",
      entityId: id,
      metadata: { display_name: current.display_name, from: current.status, to: status },
    });

    revalidatePath("/operators");
    revalidatePath(`/operators/${id}`);
    return { ok: true, message: `${current.display_name} is now ${status.replace("_", " ")}.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to change operator status." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------ assignment: create --- */

export async function createAssignment(input: CreateAssignmentInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin", "manager");

  const parsed = createAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describeAssignmentError(error) };
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
    return { ok: true, message: "Assignment created." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to assign operators." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------ assignment: update --- */

export async function updateAssignment(input: UpdateAssignmentInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updateAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describeAssignmentError(error) };
    }
    if (!updated) {
      return { ok: false, error: "That assignment no longer exists." };
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
    return { ok: true, message: "Assignment updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit assignments." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------ assignment: delete --- */

export async function deleteAssignment(input: {
  id: string;
  operator_id: string;
}): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = deleteAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid assignment." };
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
      return { ok: false, error: "Could not remove the assignment. Please try again." };
    }
    if (!deleted) {
      return { ok: false, error: "That assignment no longer exists." };
    }

    await writeAudit({
      action: "operator.assignment_delete",
      entityType: "operator_assignment",
      entityId: id,
      metadata: { operator_id },
    });

    revalidatePath(`/operators/${operator_id}`);
    return { ok: true, message: "Assignment removed." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to remove assignments." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
