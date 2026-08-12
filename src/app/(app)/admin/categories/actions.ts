"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Document-category management — SUPER ADMIN ONLY (docs/12 §2.4). A category's
 * `description` is handed VERBATIM to the classifier as the definition of the
 * category (docs/12 §2.1, §4.2), so write access to `doc_categories` is write
 * access to the classifier's instructions — a privilege that stays with the
 * Super Admin. Managers get SELECT only and never reach these actions.
 *
 * Writes go through the caller's own RLS-scoped client — the Super Admin holds
 * full CRUD on `doc_categories` — so RLS is the final authority. Every mutation
 * is audited.
 */

export type CategoryActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * The schemas are FACTORIES, not module constants: a `z.object(...)` evaluated
 * at import time is built long before any request exists and so cannot know the
 * caller's language. Each action builds its schema once it holds the auth
 * context — that is what lets a validation message come back in Russian.
 */
const slugSchema = (d: Dictionary) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .min(1, d.library.categories.actions.slugRequired)
    .max(60, d.library.categories.actions.slugTooLong)
    .regex(/^[a-z][a-z0-9_]*$/, d.library.categories.actions.slugShape);

const nameSchema = (d: Dictionary) =>
  z
    .string()
    .trim()
    .min(1, d.library.categories.actions.nameRequired)
    .max(80, d.library.categories.actions.nameTooLong);

const descriptionSchema = (d: Dictionary) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(1000, d.library.categories.actions.descriptionTooLong).nullable(),
  );

const sortSchema = (d: Dictionary) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? 0 : v),
    z.coerce
      .number()
      .int(d.library.categories.actions.sortInteger)
      .min(0, d.library.categories.actions.sortNegative)
      .max(9999, d.library.categories.actions.sortTooLarge),
  );

const createSchema = (d: Dictionary) =>
  z.object({
    slug: slugSchema(d),
    name: nameSchema(d),
    description: descriptionSchema(d),
    name_ru: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(80, d.library.categories.actions.nameTooLong).nullable().optional(),
    ),
    description_ru: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(1000, d.library.categories.actions.descriptionTooLong).nullable().optional(),
    ),
    ai_enabled: z.boolean(),
    sort: sortSchema(d),
  });

const updateSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(d.library.categories.actions.invalid),
    name: nameSchema(d),
    description: descriptionSchema(d),
    name_ru: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(80, d.library.categories.actions.nameTooLong).nullable().optional(),
    ),
    description_ru: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(1000, d.library.categories.actions.descriptionTooLong).nullable().optional(),
    ),
    ai_enabled: z.boolean(),
    sort: sortSchema(d),
  });

function firstIssue(error: z.ZodError, d: Dictionary): string {
  return error.issues[0]?.message ?? d.library.categories.actions.checkForm;
}

/* ------------------------------------------------------------------ create --- */

export async function createCategory(input: {
  slug: string;
  name: string;
  name_ru?: string | null;
  description?: string | null;
  description_ru?: string | null;
  ai_enabled: boolean;
  sort?: number | string | null;
}): Promise<CategoryActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = createSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("doc_categories")
      .insert({
        slug: data.slug,
        name: data.name,
        name_ru: data.name_ru ?? null,
        description: data.description,
        description_ru: data.description_ru ?? null,
        ai_enabled: data.ai_enabled,
        sort: data.sort,
      })
      .select("id")
      .single();

    if (error || !created) {
      if (error?.code === "23505") {
        return { ok: false, error: d.library.categories.actions.slugTaken };
      }
      return { ok: false, error: d.library.categories.actions.createFailed };
    }

    await writeAudit({
      action: "library.category_create",
      entityType: "doc_category",
      entityId: created.id,
      metadata: { slug: data.slug, name: data.name, ai_enabled: data.ai_enabled },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return { ok: true, message: d.library.categories.actions.created };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.categories.actions.forbidden };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ update --- */

/**
 * Updates a category's display fields, prompt `description`, `ai_enabled` and
 * `sort`. The `slug` is deliberately NOT editable — it is a stable machine key
 * referenced by code and seeds and is never renamed in place (docs/12 §2.1).
 */
export async function updateCategory(input: {
  id: string;
  name: string;
  name_ru?: string | null;
  description?: string | null;
  description_ru?: string | null;
  ai_enabled: boolean;
  sort?: number | string | null;
}): Promise<CategoryActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = updateSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("doc_categories")
      .update({
        name: data.name,
        name_ru: data.name_ru ?? null,
        description: data.description,
        description_ru: data.description_ru ?? null,
        ai_enabled: data.ai_enabled,
        sort: data.sort,
      })
      .eq("id", data.id)
      .select("id, slug")
      .maybeSingle();

    if (error || !updated) {
      return { ok: false, error: d.library.categories.actions.updateFailed };
    }

    await writeAudit({
      action: "library.category_update",
      entityType: "doc_category",
      entityId: data.id,
      metadata: {
        slug: updated.slug,
        name: data.name,
        ai_enabled: data.ai_enabled,
        sort: data.sort,
      },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return { ok: true, message: d.library.categories.actions.updated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.categories.actions.forbidden };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* --------------------------------------------------------- toggle ai_enabled --- */

/**
 * Flips whether the classifier may ever suggest this category (docs/12 §2.1,
 * §6). `false` removes the category from the classifier's world entirely — it is
 * never even told the category exists — so filing under it becomes human-only.
 */
export async function setCategoryEnabled(input: {
  id: string;
  ai_enabled: boolean;
}): Promise<CategoryActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  const parsed = z
    .object({
      id: z.string().uuid(d.library.categories.actions.invalid),
      ai_enabled: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const { id, ai_enabled } = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("doc_categories")
      .update({ ai_enabled })
      .eq("id", id)
      .select("id, slug")
      .maybeSingle();

    if (error || !updated) {
      return { ok: false, error: d.library.categories.actions.updateFailed };
    }

    await writeAudit({
      action: "library.category_update",
      entityType: "doc_category",
      entityId: id,
      metadata: { slug: updated.slug, ai_enabled },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return {
      ok: true,
      message: ai_enabled
        ? d.library.categories.actions.aiEnabled
        : d.library.categories.actions.aiDisabled,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.categories.actions.forbidden };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------------------ delete --- */

/**
 * Deletes a category. `library_files.category_id` is ON DELETE RESTRICT (docs/12
 * §2.2), so a category in use cannot be deleted out from under its files — the
 * database rejects it and this action surfaces a clear message.
 */
export async function deleteCategory(input: { id: string }): Promise<CategoryActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const d = dict(toLocale(profile.locale));

  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: d.library.categories.actions.invalid };
  }

  try {
    const { data: category } = await supabase
      .from("doc_categories")
      .select("id, slug, name")
      .eq("id", input.id)
      .maybeSingle();

    const { error } = await supabase.from("doc_categories").delete().eq("id", input.id);

    if (error) {
      if (error.code === "23503") {
        return { ok: false, error: d.library.categories.actions.inUse };
      }
      return { ok: false, error: d.library.categories.actions.deleteFailed };
    }

    await writeAudit({
      action: "library.category_delete",
      entityType: "doc_category",
      entityId: input.id,
      metadata: { slug: category?.slug ?? null, name: category?.name ?? null },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return { ok: true, message: d.library.categories.actions.deleted };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.library.categories.actions.forbidden };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
