import type { Metadata } from "next";

import { CategoryManager } from "@/components/library/category-manager";
import type { CategoryLite } from "@/components/library/library-meta";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Categories" };

/**
 * Document categories — SUPER ADMIN ONLY (docs/12 §2.4). This is the
 * classification vocabulary the Library files against and the classifier chooses
 * from. Because a category's `description` is prompt text handed verbatim to the
 * model (docs/12 §2.1, §4.2), write access here is write access to the
 * classifier's instructions — which is exactly why managers get SELECT only and
 * this surface is Super-Admin-gated.
 *
 * `ai_enabled = false` is a control (docs/12 §6): the classifier is never told
 * such a category exists, so filing under it is human-only. It is seeded `false`
 * for `identity`.
 */
export default async function AdminCategoriesPage() {
  const { supabase } = await requireRole("super_admin");

  const { data } = await supabase
    .from("doc_categories")
    .select("id, slug, name, description, ai_enabled, sort")
    .order("sort", { ascending: true })
    .order("name", { ascending: true });

  const categories = (data ?? []) as CategoryLite[];

  return (
    <>
      <PageHeader
        title="Categories"
        description="The Library's classification vocabulary. Each description is the prompt text the classifier uses to decide a file's category — edits change model behaviour, so this surface is Super Admin only (docs/12)."
        breadcrumbs={[{ label: "Admin" }, { label: "Categories" }]}
      />

      <CategoryManager categories={categories} />
    </>
  );
}
