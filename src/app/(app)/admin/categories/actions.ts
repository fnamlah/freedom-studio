"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
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

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Give the category a slug.")
  .max(60, "That slug is too long.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Slug must be lowercase letters, numbers and underscores, starting with a letter.",
  );

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the category a name.")
  .max(80, "That name is too long.");

const descriptionSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().max(1000, "That description is too long.").nullable(),
);

const sortSchema = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : v),
  z.coerce
    .number()
    .int("Sort must be a whole number.")
    .min(0, "Sort cannot be negative.")
    .max(9999, "That sort value is too large."),
);

const createSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema,
  ai_enabled: z.boolean(),
  sort: sortSchema,
});

const updateSchema = z.object({
  id: z.string().uuid("Invalid category."),
  name: nameSchema,
  description: descriptionSchema,
  ai_enabled: z.boolean(),
  sort: sortSchema,
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/* ------------------------------------------------------------------ create --- */

export async function createCategory(input: {
  slug: string;
  name: string;
  description?: string | null;
  ai_enabled: boolean;
  sort?: number | string | null;
}): Promise<CategoryActionResult> {
  const { supabase } = await requireRole("super_admin");

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("doc_categories")
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description,
        ai_enabled: data.ai_enabled,
        sort: data.sort,
      })
      .select("id")
      .single();

    if (error || !created) {
      if (error?.code === "23505") {
        return { ok: false, error: "A category with that slug already exists." };
      }
      return { ok: false, error: "Could not create the category. Please try again." };
    }

    await writeAudit({
      action: "library.category_create",
      entityType: "doc_category",
      entityId: created.id,
      metadata: { slug: data.slug, name: data.name, ai_enabled: data.ai_enabled },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return { ok: true, message: "Category created." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage categories." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  description?: string | null;
  ai_enabled: boolean;
  sort?: number | string | null;
}): Promise<CategoryActionResult> {
  const { supabase } = await requireRole("super_admin");

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("doc_categories")
      .update({
        name: data.name,
        description: data.description,
        ai_enabled: data.ai_enabled,
        sort: data.sort,
      })
      .eq("id", data.id)
      .select("id, slug")
      .maybeSingle();

    if (error || !updated) {
      return { ok: false, error: "Could not update the category. Please try again." };
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
    return { ok: true, message: "Category updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage categories." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
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
  const { supabase } = await requireRole("super_admin");

  const parsed = z
    .object({ id: z.string().uuid("Invalid category."), ai_enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: "Could not update the category. Please try again." };
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
      message: ai_enabled ? "Category enabled for AI suggestions." : "Category is now human-only filing.",
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage categories." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------------------ delete --- */

/**
 * Deletes a category. `library_files.category_id` is ON DELETE RESTRICT (docs/12
 * §2.2), so a category in use cannot be deleted out from under its files — the
 * database rejects it and this action surfaces a clear message.
 */
export async function deleteCategory(input: { id: string }): Promise<CategoryActionResult> {
  const { supabase } = await requireRole("super_admin");

  if (!z.string().uuid().safeParse(input.id).success) {
    return { ok: false, error: "Invalid category." };
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
        return {
          ok: false,
          error: "This category is in use by one or more files and cannot be deleted.",
        };
      }
      return { ok: false, error: "Could not delete the category. Please try again." };
    }

    await writeAudit({
      action: "library.category_delete",
      entityType: "doc_category",
      entityId: input.id,
      metadata: { slug: category?.slug ?? null, name: category?.name ?? null },
    });

    revalidatePath("/admin/categories");
    revalidatePath("/library");
    return { ok: true, message: "Category deleted." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to manage categories." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
