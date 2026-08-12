import type { Metadata } from "next";
import Link from "next/link";

import { LibraryWorkspace } from "@/components/library/library-workspace";
import type { CategoryLite, LibraryFileLite } from "@/components/library/library-meta";
import {
  CATEGORY_COLUMNS,
  normaliseKeyFigures,
} from "@/components/library/library-meta";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { optionalEnv } from "@/lib/env";
import { getDict } from "@/lib/i18n/server";
import { getSetting } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).library.metaTitle };
}

/**
 * File Library — the studio's own filing cabinet (docs/12 §1). Super Admin and
 * Manager only: models, finance and operators have no policy on `library_files`
 * or `doc_categories`, so the Library is not merely empty for them — it is
 * invisible (docs/12 §1, §2.4).
 *
 * Files are org-wide (no `model_id`), stored in the private `library` bucket with
 * a FLAT key, and organized by virtual folders (a DB column, derived into a tree
 * client-side) plus a category vocabulary. Classification is a per-file AI
 * suggestion that a human confirms or overrides — the machine never files
 * anything (docs/12 §4.3). This is a different table, bucket and threat profile
 * from the compliance documents of docs/06.
 */
export default async function LibraryPage() {
  const { supabase, role } = await requireRole("super_admin", "manager");
  const isSuperAdmin = role === "super_admin";
  const d = await getDict();

  const [{ data: categoriesData }, { data: filesData }] = await Promise.all([
    supabase
      .from("doc_categories")
      .select(CATEGORY_COLUMNS)
      .order("sort", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("library_files")
      .select(
        "id, folder_path, name, mime_type, size_bytes, category_id, ai_suggested_category_id, ai_confidence, ai_rationale, ai_summary, ai_key_figures, ai_status, ai_exempt, classified_provider, classified_at, created_at",
      )
      .order("created_at", { ascending: false }),
  ]);

  const categories = (categoriesData ?? []) as CategoryLite[];
  const files: LibraryFileLite[] = (filesData ?? []).map((f) => ({
    ...(f as Omit<LibraryFileLite, "ai_key_figures">),
    ai_key_figures: normaliseKeyFigures((f as { ai_key_figures?: unknown }).ai_key_figures),
  }));

  // Wave-2 route/provider readiness. Keys are server-only env (docs/11 §1); with
  // neither set the workspace shows the graceful "AI not configured" state up
  // front. Even when a key is present, the client also falls back gracefully if
  // the /api/ai/classify route is not built yet.
  const aiConfigured = Boolean(
    optionalEnv("MOONSHOT_API_KEY") || optionalEnv("ZHIPU_API_KEY"),
  );

  // Informational only; defensive so a settings-read hiccup never breaks the page.
  let aiMaxFileMb = 10;
  try {
    aiMaxFileMb = await getSetting<number>("ai.classify.max_file_mb", 10);
  } catch {
    aiMaxFileMb = 10;
  }

  const counts = files.reduce(
    (acc, file) => {
      acc.total += 1;
      if (file.ai_status === "suggested") acc.suggested += 1;
      if (file.ai_status === "pending" && !file.ai_exempt) acc.pending += 1;
      if (file.category_id) acc.filed += 1;
      return acc;
    },
    { total: 0, suggested: 0, pending: 0, filed: 0 },
  );

  return (
    <>
      <PageHeader
        title={d.library.title}
        description={d.library.description}
        breadcrumbs={[{ label: d.library.title }]}
        actions={
          isSuperAdmin ? (
            <Link
              href="/admin/categories"
              className="text-sm text-primary hover:underline"
            >
              {d.library.manageCategories}
            </Link>
          ) : undefined
        }
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile
          label={d.library.statFiles}
          value={counts.total}
          hint={d.library.statFilesHint}
        />
        <StatTile
          label={d.library.statFiled}
          value={counts.filed}
          hint={d.library.statFiledHint}
        />
        <StatTile
          label={d.library.statPending}
          value={counts.pending}
          hint={d.library.statPendingHint}
        />
        <StatTile
          label={d.library.statNeedsReview}
          value={counts.suggested}
          hint={d.library.statNeedsReviewHint}
        />
      </StatTileRow>

      {categories.length === 0 ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {d.library.noCategories}
          {isSuperAdmin ? (
            <>
              {" "}
              <Link href="/admin/categories" className="text-primary hover:underline">
                {d.library.noCategoriesCta}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <LibraryWorkspace
        files={files}
        categories={categories}
        aiConfigured={aiConfigured}
        aiMaxFileMb={aiMaxFileMb}
      />
    </>
  );
}
