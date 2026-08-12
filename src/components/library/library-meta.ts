/**
 * Client-safe shared constants, types and derivations for the File Library
 * module (docs/12). No server-only imports here, so this file may be pulled into
 * both the server actions/pages and the `"use client"` components.
 *
 * It carries: the review-status and category badge vocabularies; the
 * virtual-folder helpers (docs/12 §1 — the folder is a DB column only, so the
 * tree is derived, never stored); and the client-side driver for the batch
 * classification loop of docs/12 §4.4.
 *
 * Display TEXT lives in `@/lib/i18n` — including the REQUIRED upload notice of
 * docs/12 §6 (`d.library.exemptNotice`). The one exception is a category's own
 * name and description: the vocabulary is user-manageable, so those come from
 * `doc_categories` (`name`/`name_ru`, migration 019) and are picked below.
 */

import type { BadgeVariant } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";

export type AiReviewStatus = Database["public"]["Enums"]["ai_review_status"];
export type AiProvider = Database["public"]["Enums"]["ai_provider"];

/** Only the columns the Library UI needs — never `storage_path`/`sha256`. */
export type CategoryLite = {
  id: string;
  slug: string;
  name: string;
  /** Russian display name (migration 019). Null falls back to `name`. */
  name_ru: string | null;
  description: string | null;
  /** Russian prompt text (migration 019). Null falls back to `description`. */
  description_ru: string | null;
  ai_enabled: boolean;
  sort: number;
};

/** The columns every category query must select for the helpers below to work. */
export const CATEGORY_COLUMNS =
  "id, slug, name, name_ru, description, description_ru, ai_enabled, sort";

/**
 * A category's display name in the reader's language. The vocabulary is
 * user-manageable — a Super Admin may add a category the dictionary has never
 * heard of — so the translation lives in the row, not in `@/lib/i18n`. A
 * category added without a Russian name still renders (as its `name`) rather
 * than as a blank pill.
 */
export function categoryName(
  category: Pick<CategoryLite, "name" | "name_ru"> | null | undefined,
  locale: Locale,
): string {
  if (!category) return "";
  return (locale === "ru" ? category.name_ru : null) || category.name;
}

/** The same fallback for the classifier prompt text shown in the admin table. */
export function categoryDescription(
  category: Pick<CategoryLite, "description" | "description_ru"> | null | undefined,
  locale: Locale,
): string | null {
  if (!category) return null;
  return (locale === "ru" ? category.description_ru : null) || category.description;
}

export type LibraryFileLite = {
  id: string;
  folder_path: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  category_id: string | null;
  ai_suggested_category_id: string | null;
  ai_confidence: number | null;
  ai_rationale: string | null;
  ai_summary: string | null;
  ai_key_figures: { label: string; value: string }[];
  ai_status: AiReviewStatus;
  ai_exempt: boolean;
  classified_provider: AiProvider | null;
  classified_at: string | null;
  created_at: string;
};

/* ------------------------------------------------------- review-status meta --- */

/**
 * Badge appearance per review status. The LABELS live in `d.library.aiStatus`
 * — keyed by the same enum values — because they are read by people; only the
 * colour is a property of the state itself.
 */
export const AI_STATUS_META: Record<
  AiReviewStatus,
  { variant: BadgeVariant; dot?: boolean }
> = {
  pending: { variant: "muted" },
  suggested: { variant: "warning", dot: true },
  confirmed: { variant: "success" },
  overridden: { variant: "primary" },
  skipped: { variant: "muted" },
  failed: { variant: "danger" },
};

/**
 * Badge colour per seeded category slug (docs/12 §5). Categories are
 * user-manageable, so any slug not listed here — including ones the Super Admin
 * adds — falls back to a neutral pill.
 */
export const CATEGORY_SLUG_VARIANT: Record<string, BadgeVariant> = {
  incoming_money: "success",
  receipts: "warning",
  legal: "danger",
  regulations: "neutral",
  policies: "neutral",
  contracts: "primary",
  tax: "primary",
  identity: "danger",
  other: "muted",
};

export function categoryVariant(slug: string | null | undefined): BadgeVariant {
  return (slug && CATEGORY_SLUG_VARIANT[slug]) || "neutral";
}

/* --------------------------------------------------------------- upload caps --- */

/** App-layer upload ceiling. Storage RLS is the real boundary (docs/12 §2.5). */
export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/* ------------------------------------------------------------ virtual folders --- */

export type FolderNode = {
  path: string;
  name: string;
  directCount: number;
  totalCount: number;
  depth: number;
  children: FolderNode[];
};

/**
 * Normalizes a user-entered folder path to the stored shape: leading `/`,
 * single-slash separators, sanitized segments, no trailing slash (docs/12 §2.2,
 * DB CHECK `folder_path LIKE '/%'`). Empty input collapses to the root `/`.
 */
export function normalizeFolderPath(input: string | null | undefined): string {
  if (input === null || input === undefined) return "/";
  const raw = String(input).replace(/\\/g, "/").trim();
  if (raw === "") return "/";

  const segments = raw
    .split("/")
    .map((seg) =>
      seg
        .normalize("NFKC")
        .trim()
        .replace(/[^\w.\- ]+/g, "_")
        .replace(/\s+/g, " ")
        .replace(/_+/g, "_")
        .replace(/^[.]+/, "")
        .slice(0, 60),
    )
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Builds the folder tree rooted at `/` from the files' `folder_path` values.
 * `rootName` is the only piece of display text in the tree — every other node is
 * named by a path segment the user typed — so it is passed in translated rather
 * than hardcoded here (`d.library.allFiles`).
 */
export function buildFolderTree(
  files: { folder_path: string }[],
  rootName: string,
): FolderNode {
  const direct = new Map<string, number>();
  const allPaths = new Set<string>(["/"]);

  for (const file of files) {
    const path = normalizeFolderPath(file.folder_path);
    direct.set(path, (direct.get(path) ?? 0) + 1);
    allPaths.add(path);
    // Materialize every ancestor so intermediate folders exist in the tree.
    let cursor = path;
    while (cursor !== "/") {
      const idx = cursor.lastIndexOf("/");
      cursor = idx <= 0 ? "/" : cursor.slice(0, idx);
      allPaths.add(cursor);
    }
  }

  const nodes = new Map<string, FolderNode>();
  for (const path of allPaths) {
    nodes.set(path, {
      path,
      name: path === "/" ? rootName : path.slice(path.lastIndexOf("/") + 1),
      directCount: direct.get(path) ?? 0,
      totalCount: 0,
      depth: path === "/" ? 0 : path.split("/").length - 1,
      children: [],
    });
  }

  for (const path of allPaths) {
    if (path === "/") continue;
    const idx = path.lastIndexOf("/");
    const parentPath = idx <= 0 ? "/" : path.slice(0, idx);
    nodes.get(parentPath)?.children.push(nodes.get(path)!);
  }

  const root = nodes.get("/")!;
  const computeTotal = (node: FolderNode): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    let total = node.directCount;
    for (const child of node.children) total += computeTotal(child);
    node.totalCount = total;
    return total;
  };
  computeTotal(root);
  return root;
}

/** True when `filePath` sits in `selected` or any of its descendant folders. */
export function isInFolder(filePath: string, selected: string): boolean {
  const p = normalizeFolderPath(filePath);
  const s = normalizeFolderPath(selected);
  if (s === "/") return true;
  return p === s || p.startsWith(`${s}/`);
}

/* ---------------------------------------------------- classification driver --- */

/**
 * Result of one POST to `/api/ai/classify` (built in Wave 2, docs/12 §4.4).
 * `not_configured` is returned both when the route does not exist yet and when
 * the provider is unset — either way the UI shows the graceful "AI not
 * configured" state rather than an error.
 */
export type ClassifyOutcome =
  | { status: "ok"; done: number; remaining: number }
  | { status: "not_configured" }
  | { status: "error"; message: string };

/**
 * Drives one classification call. Pass `{ file_id }` to classify a single
 * pending file, or `{}` to take the next batch (docs/12 §4.4). The route is
 * expected to return `{ done, remaining }`; a 404/501/503 (route absent) or a
 * `{ configured: false }` body flips the UI into the not-configured state.
 */
export async function runClassify(
  d: Dictionary,
  body: { file_id?: string } = {},
): Promise<ClassifyOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/ai/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { status: "error", message: d.library.classifyUnreachable };
  }

  if (res.status === 404 || res.status === 501 || res.status === 503) {
    return { status: "not_configured" };
  }

  if (!res.ok) {
    let message = d.library.classifyFailed;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data?.error === "string") message = data.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    return { status: "error", message };
  }

  try {
    const data = (await res.json()) as {
      done?: number;
      remaining?: number;
      configured?: boolean;
    };
    if (data?.configured === false) return { status: "not_configured" };
    return {
      status: "ok",
      done: Number(data?.done ?? 0),
      remaining: Number(data?.remaining ?? 0),
    };
  } catch {
    return { status: "error", message: d.library.classifyBadResponse };
  }
}

/* --------------------------------------------------------- analysis output --- */

export type KeyFigure = { label: string; value: string };

/** Coerce the jsonb `ai_key_figures` column into a clean {label,value}[]. */
export function normaliseKeyFigures(raw: unknown): KeyFigure[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyFigure[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const label = (item as Record<string, unknown>).label;
      const value = (item as Record<string, unknown>).value;
      if (typeof label === "string" && typeof value === "string") {
        out.push({ label, value });
      }
    }
  }
  return out;
}
