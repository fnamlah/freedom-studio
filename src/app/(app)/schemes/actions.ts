"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";
import {
  describeDbError,
  emptyToNull,
  firstIssue,
  isValidYmd,
  type SqlStateMessages,
} from "@/lib/forms";

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
 *
 * Every message the client can surface is resolved from the CALLER's dictionary
 * — `requireRole` already loaded their profile, so the locale costs nothing.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const SCHEME_SCOPES = ["default", "model", "account"] as const;
type SchemeScopeInput = (typeof SCHEME_SCOPES)[number];

/* -------------------------------------------------------------- validation --- */

/**
 * FACTORIES, not module constants. A module-scope `z.object` is evaluated at
 * import time — before any request and therefore before any locale — so its
 * messages could only ever be one language.
 *
 * The percent field takes the FIELD, not an interpolated label: "Enter the
 * ${label} percentage" cannot be translated, because Russian inflects the noun
 * inside the sentence. Three fields, three whole sentences per rule.
 */
type PercentField = "model" | "operator" | "studio";

const percentField = (d: Dictionary, field: PercentField) =>
  z.coerce
    .number({ invalid_type_error: d.money.schemes.percentRequired[field] })
    .min(0, d.money.schemes.percentNegative[field])
    .max(100, d.money.schemes.percentMax[field]);

const effectiveFrom = (d: Dictionary) =>
  z.string().refine(isValidYmd, d.money.schemes.errEffectiveFrom);

const effectiveTo = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().refine(isValidYmd, d.money.schemes.errEffectiveTo).nullable(),
    )
    .optional();

const optionalNotes = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.string().trim().max(4000, d.money.schemes.errNotesTooLong).nullable(),
    )
    .optional();

/** The shared money-split + effective-dating fields, with cross-field refinements. */
const splitFields = (d: Dictionary) => ({
  model_percent: percentField(d, "model"),
  operator_percent: percentField(d, "operator"),
  studio_percent: percentField(d, "studio"),
  effective_from: effectiveFrom(d),
  effective_to: effectiveTo(d),
  notes: optionalNotes(d),
});

/** The two refinements shared by create and update. */
function refineSplit<T extends z.ZodTypeAny>(d: Dictionary, schema: T) {
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
        message: d.money.schemes.errSumNot100,
        path: ["studio_percent"],
      },
    )
    .refine(
      (v: { effective_from: string; effective_to?: string | null }) =>
        v.effective_to == null || v.effective_to > v.effective_from,
      {
        message: d.money.schemes.errEffectiveOrder,
        path: ["effective_to"],
      },
    );
}

const createSchema = (d: Dictionary) =>
  refineSplit(
    d,
    z.object({
      scope: z.enum(SCHEME_SCOPES),
      model_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
      platform_account_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
      ...splitFields(d),
    }),
  ).superRefine((v, ctx) => {
    if (v.scope === "model" && !v.model_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: d.money.schemes.errChooseModel,
        path: ["model_id"],
      });
    }
    if (v.scope === "account" && !v.platform_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: d.money.schemes.errChooseAccount,
        path: ["platform_account_id"],
      });
    }
  });

// Update never changes scope (a scheme's scope is its identity — a different
// scope is a different scheme). Only the split, effective window, and notes edit.
const updateSchema = (d: Dictionary) =>
  refineSplit(
    d,
    z.object({
      id: z.string().uuid(),
      ...splitFields(d),
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

/* ------------------------------------------------------------------ create --- */

/** SQLSTATEs this area turns into prose; anything else gets the generic fallback. */
function dbMessages(d: Dictionary): SqlStateMessages {
  return { "23503": d.money.schemes.errDbMissingRef };
}

export async function createScheme(input: CreateSchemeInput): Promise<ActionResult> {
  const { supabase, user, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.schemes.errCheckForm) };
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
      return { ok: false, error: describeDbError(error?.code, dbMessages(d), d.money.schemes.errSaveFailed) };
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
    return { ok: true, message: d.money.schemes.okCreated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.schemes.errNotAuthorized };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ update --- */

export async function updateScheme(input: UpdateSchemeInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = updateSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.schemes.errCheckForm) };
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
      return { ok: false, error: describeDbError(error.code, dbMessages(d), d.money.schemes.errSaveFailed) };
    }
    if (!updated) {
      return { ok: false, error: d.money.schemes.errGone };
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
    return { ok: true, message: d.money.schemes.okUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.schemes.errNotAuthorized };
    }
    return { ok: false, error: d.common.unknownError };
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
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.money.schemes.errInvalidRef };
  }
  const { id } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("commission_schemes")
      .select("id, model_id, platform_account_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.money.schemes.errLoadFailed };
    }
    if (!current) {
      return { ok: false, error: d.money.schemes.errGone };
    }
    if (current.model_id === null && current.platform_account_id === null) {
      return { ok: false, error: d.money.schemes.errDefaultUndeletable };
    }

    const { error: deleteError } = await supabase
      .from("commission_schemes")
      .delete()
      .eq("id", id);

    if (deleteError) {
      if (deleteError.code === "23503") {
        return { ok: false, error: d.money.schemes.errHasLedgerEntries };
      }
      // Default-guard trigger or any other DB-level block.
      return { ok: false, error: d.money.schemes.errDeleteBlocked };
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
    return { ok: true, message: d.money.schemes.okDeleted };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.schemes.errNotAuthorized };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------- tiers --- */

/**
 * Income tiers (023): a scheme's percentages are not fixed — the more the model
 * earns in a WEEK, the better her split, and the team pool and studio share move
 * with it.
 *
 * The whole ladder saves at once, through `fn_set_commission_tiers` (024), which
 * replaces it inside ONE transaction. Doing this as a DELETE then an INSERT over
 * two requests would, on a failed second call, leave the scheme silently back on
 * its base rates — no error, just quietly wrong money at the next close.
 *
 * An empty ladder is a legitimate save: it clears the tiers and returns the
 * scheme to its own percentages.
 */
const tierRow = (d: Dictionary) =>
  z
    .object({
      min_amount: z.coerce
        .number({ invalid_type_error: d.money.schemes.tiers.errMinRequired })
        .min(0, d.money.schemes.tiers.errMinNegative),
      model_percent: percentField(d, "model"),
      operator_percent: percentField(d, "operator"),
      studio_percent: percentField(d, "studio"),
    })
    // Same 100% rule and the same 2-decimal rounding as a scheme's own split,
    // but stated separately: a tier has no effective window, so it does not
    // carry `refineSplit`'s date-ordering check.
    .refine(
      (v) =>
        Math.round((v.model_percent + v.operator_percent + v.studio_percent) * 100) / 100 === 100,
      { message: d.money.schemes.tiers.errSumNot100, path: ["studio_percent"] },
    );

const tiersSchema = (d: Dictionary) =>
  z
    .object({
      scheme_id: z.string().uuid(),
      tiers: z.array(tierRow(d)).max(20, d.money.schemes.tiers.errTooMany),
    })
    .refine(
      (v) => new Set(v.tiers.map((t) => t.min_amount)).size === v.tiers.length,
      { message: d.money.schemes.tiers.errDuplicateMin, path: ["tiers"] },
    );

export type TierInput = {
  min_amount: string | number;
  model_percent: string | number;
  operator_percent: string | number;
  studio_percent: string | number;
};

export async function saveSchemeTiers(input: {
  scheme_id: string;
  tiers: TierInput[];
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = tiersSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d.money.schemes.tiers.errCheckForm) };
  }

  // Ascending on the way in, so the table reads as a ladder regardless of the
  // order the rows were typed in.
  const tiers = [...parsed.data.tiers]
    .sort((a, b) => a.min_amount - b.min_amount)
    .map((t) => ({
      min_amount: t.min_amount,
      model_percent: t.model_percent,
      operator_percent: t.operator_percent,
      studio_percent: t.studio_percent,
    }));

  try {
    const { error } = await supabase.rpc("fn_set_commission_tiers", {
      p_scheme_id: parsed.data.scheme_id,
      p_tiers: tiers,
    });

    if (error) {
      return {
        ok: false,
        error: describeDbError(
          error.code,
          {
            "23503": d.money.schemes.errGone,
            "23505": d.money.schemes.tiers.errDuplicateMin,
            "23514": d.money.schemes.tiers.errDbCheck,
            "42501": d.money.schemes.errNotAuthorized,
          },
          d.money.schemes.tiers.errSaveFailed,
        ),
      };
    }

    await writeAudit({
      action: "scheme.update",
      entityType: "commission_scheme",
      entityId: parsed.data.scheme_id,
      metadata: { op: "tiers", count: tiers.length, tiers },
    });

    revalidatePath("/schemes");
    return {
      ok: true,
      message: tiers.length === 0 ? d.money.schemes.tiers.okCleared : d.money.schemes.tiers.okSaved,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.money.schemes.errNotAuthorized };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
