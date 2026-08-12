/**
 * Client-safe shared constants, types and derivations for the File Library
 * module (docs/12). No server-only imports here, so this file may be pulled into
 * both the server actions/pages and the `"use client"` components.
 *
 * It carries: the review-status and category badge vocabularies; the REQUIRED
 * upload notice from docs/12 §6; the virtual-folder helpers (docs/12 §1 — the
 * folder is a DB column only, so the tree is derived, never stored); and the
 * client-side driver for the batch classification loop of docs/12 §4.4.
 */

import type { BadgeVariant } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

export type AiReviewStatus = Database["public"]["Enums"]["ai_review_status"];
export type AiProvider = Database["public"]["Enums"]["ai_provider"];

/** Only the columns the Library UI needs — never `storage_path`/`sha256`. */
export type CategoryLite = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ai_enabled: boolean;
  sort: number;
};

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

export const AI_STATUS_META: Record<
  AiReviewStatus,
  { label: string; variant: BadgeVariant; dot?: boolean }
> = {
  pending: { label: "Pending", variant: "muted" },
  suggested: { label: "Needs review", variant: "warning", dot: true },
  confirmed: { label: "Confirmed", variant: "success" },
  overridden: { label: "Overridden", variant: "primary" },
  skipped: { label: "Skipped", variant: "muted" },
  failed: { label: "Failed", variant: "danger" },
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

/**
 * The REQUIRED sentence from docs/12 §6 ("The honest limitation"). Exemption is
 * a decision made AT UPLOAD: a file nobody marks exempt transits the provider
 * once, before any suggestion exists to review. This must be stated plainly in
 * the upload UI — it is the studio's procedural protection, not a technical one.
 */
export const EXEMPT_NOTICE =
  "Anything not marked exempt will be sent to the AI provider once for classification.";

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

/** Builds the folder tree rooted at `/` from the files' `folder_path` values. */
export function buildFolderTree(files: { folder_path: string }[]): FolderNode {
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
      name: path === "/" ? "All files" : path.slice(path.lastIndexOf("/") + 1),
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
export async function runClassify(body: { file_id?: string } = {}): Promise<ClassifyOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/ai/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { status: "error", message: "Could not reach the classification service." };
  }

  if (res.status === 404 || res.status === 501 || res.status === 503) {
    return { status: "not_configured" };
  }

  if (!res.ok) {
    let message = "Classification failed. Please try again.";
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
    return { status: "error", message: "Unexpected response from the classification service." };
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
