"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Commission-scheme writes — Super Admin only (docs/03 §3: schemes are `CRUD`
 * for SA, `read` for MGR/FIN, denied to models/operators; docs/09 §4.2: "Scheme
 * writes are Super-Admin-only and audited (`scheme.update`)").
 *
 * Every action opens with `requireRole("super_admin")`, which redirects any other
 * caller BEFORE any work runs — a Manager reaching the read-only page can never
 * invoke these because the guard is the hard gate. Writes go through the caller's
 * own RLS-scoped client, so RLS is the final authority. Each mutation appends an
 * `audit_log` row via `writeAudit("scheme.update", …)` (docs/04 §4.16).
 *
 * The three-way split invariant (`model + operator + studio = 100`), the scope
 * exclusivity (never both `model_id` and `platform_account_id`), the effective
 * ordering (`effective_to > effective_from`), and the no-overlap-per-scope GiST
 * exclusion are all enforced by the database (docs/04 §4.9). The zod schema below
 * mirrors the first three for a fast, friendly message; the DB is the last word.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const SCHEME_SCOPES = ["default", "model", "account"] as const;
type SchemeScopeInput = (typeof SCHEME_SCOPES)[number];

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

const percentField = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `Enter the ${label} percentage.` })
    .min(0, `${label} can't be negative.`)
    .max(100, `${label} can't exceed 100%.`);

const effectiveFrom = z
  .string()
  .refine(isValidYmd, "Enter a valid effective-from date (YYYY-MM-DD).");

const effectiveTo = z
  .preprocess(
    emptyToNull,
    z.string().refine(isValidYmd, "Enter a valid effective-to date (YYYY-MM-DD).").nullable(),
  )
  .optional();

const optionalNotes = z
  .preprocess(emptyToNull, z.string().trim().max(4000, "Notes are too long.").nullable())
  .optional();

/** The shared money-split + effective-dating fields, with cross-field refinements. */
const splitFields = {
  model_percent: percentField("model"),
  operator_percent: percentField("operator pool"),
  studio_percent: percentField("studio"),
  effective_from: effectiveFrom,
  effective_to: effectiveTo,
  notes: optionalNotes,
};

/** The two refinements shared by create and update. */
function refineSplit<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (v: {
        model_percent: number;
        operator_percent: number;
        studio_percent: number;
      }) =>
        // Round to the 2-decimal money grain before comparing so exact splits
        // like 33.33 / 33.33 / 33.34 aren't rejected by float drift. The DB
        // CHECK on numeric(5,2) is the exact-decimal authority (docs/04 §4.9).
        Math.round((v.model_percent + v.operator_percent + v.studio_percent) * 100) / 100 ===
        100,
      {
        message: "Model, operator and studio percentages must add up to exactly 100%.",
        path: ["studio_percent"],
      },
    )
    .refine(
      (v: { effective_from: string; effective_to?: string | null }) =>
        v.effective_to == null || v.effective_to > v.effective_from,
      {
        message: "The effective-to date must be after the effective-from date.",
        path: ["effective_to"],
      },
    );
}

const createSchema = refineSplit(
  z.object({
    scope: z.enum(SCHEME_SCOPES),
    model_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
    platform_account_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
    ...splitFields,
  }),
).superRefine((v, ctx) => {
  if (v.scope === "model" && !v.model_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a model.", path: ["model_id"] });
  }
  if (v.scope === "account" && !v.platform_account_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose a platform account.",
      path: ["platform_account_id"],
    });
  }
});

// Update never changes scope (a scheme's scope is its identity — a different
// scope is a different scheme). Only the split, effective window, and notes edit.
const updateSchema = refineSplit(
  z.object({
    id: z.string().uuid(),
    ...splitFields,
  }),
);

const deleteSchema = z.object({ id: z.string().uuid() });

/* ------------------------------------------------------------------ types --- */

export type CreateSchemeInput = {
  scope: SchemeScopeInput;
  model_id?: string | null;
  platform_account_id?: string | null;
  model_percent: string | number;
  operator_percent: string | number;
  studio_percent: string | number;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
};

export type UpdateSchemeInput = {
  id: string;
  model_percent: string | number;
  operator_percent: string | number;
  studio_percent: string | number;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
};

/* ---------------------------------------------------------------- helpers --- */

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/** Maps a Postgres error to a friendly message; DB constraints back-stop zod. */
function describeWriteError(code: string | undefined): string {
  if (code === "23514") {
    // CHECK: percentages don't sum to 100, a percent is out of 0–100, or
    // effective_to <= effective_from, or both scope columns are set.
    return "That doesn't satisfy a database rule — percentages must total 100% and the effective dates must be in order.";
  }
  if (code === "23P01") {
    // EXCLUDE USING gist — another scheme in the same scope already covers part
    // of this date range (docs/04 §4.9).
    return "Another scheme for this scope already covers part of that date range. Close the current scheme with an effective-to date first, then add the successor.";
  }
  if (code === "23503") {
    return "The selected model or account no longer exists.";
  }
  return "Could not save the scheme. Please try again.";
}

/* ------------------------------------------------------------------ create --- */

export async function createScheme(input: CreateSchemeInput): Promise<ActionResult> {
  const { supabase, user } = await requireRole("super_admin");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  // Normalize scope into the two nullable columns (never both set — docs/04 §4.9).
  const model_id = data.scope === "model" ? data.model_id ?? null : null;
  const platform_account_id =
    data.scope === "account" ? data.platform_account_id ?? null : null;

  try {
    const { data: created, error } = await supabase
      .from("commission_schemes")
      .insert({
        model_id,
        platform_account_id,
        model_percent: data.model_percent,
        operator_percent: data.operator_percent,
        studio_percent: data.studio_percent,
        effective_from: data.effective_from,
        effective_to: data.effective_to ?? null,
        notes: data.notes ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeWriteError(error?.code) };
    }

    await writeAudit({
      action: "scheme.update",
      entityType: "commission_scheme",
      entityId: created.id,
      metadata: {
        op: "create",
        scope: data.scope,
        model_id,
        platform_account_id,
        split: {
          model: data.model_percent,
          operator: data.operator_percent,
          studio: data.studio_percent,
        },
        effective_from: data.effective_from,
        effective_to: data.effective_to ?? null,
      },
    });

    revalidatePath("/schemes");
    return { ok: true, message: "Commission scheme added." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage commission schemes." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateScheme(input: UpdateSchemeInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("commission_schemes")
      .update({
        model_percent: data.model_percent,
        operator_percent: data.operator_percent,
        studio_percent: data.studio_percent,
        effective_from: data.effective_from,
        effective_to: data.effective_to ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeWriteError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That scheme no longer exists." };
    }

    await writeAudit({
      action: "scheme.update",
      entityType: "commission_scheme",
      entityId: data.id,
      metadata: {
        op: "update",
        split: {
          model: data.model_percent,
          operator: data.operator_percent,
          studio: data.studio_percent,
        },
        effective_from: data.effective_from,
        effective_to: data.effective_to ?? null,
      },
    });

    revalidatePath("/schemes");
    return { ok: true, message: "Commission scheme updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage commission schemes." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ delete --- */

/**
 * Deletes a scheme. The **default scheme (both scope columns NULL) can never be
 * deleted** — exactly one must exist at all times (docs/04 §4.9, docs/09 §4.1).
 * The database blocks it; we pre-check to give a clear message and avoid a
 * needless round-trip, and still map any DB-level block (default-guard trigger,
 * or a `ledger_entries.commission_scheme_id` provenance FK) to friendly text.
 */
export async function deleteScheme(input: { id: string }): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin");

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid scheme reference." };
  }
  const { id } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("commission_schemes")
      .select("id, model_id, platform_account_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: "Could not load that scheme." };
    }
    if (!current) {
      return { ok: false, error: "That scheme no longer exists." };
    }
    if (current.model_id === null && current.platform_account_id === null) {
      return {
        ok: false,
        error: "The studio default scheme can't be deleted — exactly one default must always exist.",
      };
    }

    const { error: deleteError } = await supabase
      .from("commission_schemes")
      .delete()
      .eq("id", id);

    if (deleteError) {
      if (deleteError.code === "23503") {
        return {
          ok: false,
          error:
            "This scheme has already produced ledger entries and can't be deleted. Close it with an effective-to date instead.",
        };
      }
      // Default-guard trigger or any other DB-level block.
      return {
        ok: false,
        error: "The database blocked this deletion. If this is the default scheme, it can't be removed.",
      };
    }

    await writeAudit({
      action: "scheme.update",
      entityType: "commission_scheme",
      entityId: id,
      metadata: {
        op: "delete",
        model_id: current.model_id,
        platform_account_id: current.platform_account_id,
      },
    });

    revalidatePath("/schemes");
    return { ok: true, message: "Commission scheme deleted." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage commission schemes." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
