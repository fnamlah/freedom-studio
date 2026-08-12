import type { Metadata } from "next";

import { CategoryManager } from "@/components/library/category-manager";
import {
  CATEGORY_COLUMNS,
  type CategoryLite,
} from "@/components/library/library-meta";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/guard";
import { getDict } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).library.categories.metaTitle };
}

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
  const d = await getDict();

  const { data } = await supabase
    .from("doc_categories")
    .select(CATEGORY_COLUMNS)
    .order("sort", { ascending: true })
    .order("name", { ascending: true });

  const categories = (data ?? []) as CategoryLite[];

  return (
    <>
      <PageHeader
        title={d.library.categories.title}
        description={d.library.categories.description}
        breadcrumbs={[
          { label: d.nav.sectionAdmin },
          { label: d.library.categories.title },
        ]}
      />

      <CategoryManager categories={categories} />
    </>
  );
}
