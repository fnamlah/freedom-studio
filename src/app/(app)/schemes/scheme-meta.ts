import type { BadgeVariant } from "@/components/ui/badge";

import type { RateRow } from "./rate-card";

/**
 * Shared, client-safe vocabulary for commission schemes (docs/09 §4, docs/04 §4.9).
 *
 * A scheme applies at exactly one of three scopes; resolution walks them from most
 * to least specific — **account > model > default** — matching on the earning
 * row's `period_end` (docs/09 §4.1). This module holds the pure derivations and
 * the LANGUAGE-INDEPENDENT display metadata — badge colours and resolution order
 * — so the server page and the client table agree on them.
 *
 * The words themselves (`label`, `short`, `description`) live in
 * `d.money.schemes.scope` / `d.money.schemes.status`: a module constant is
 * evaluated once at import and can only ever hold one language.
 */

export type SchemeScope = "account" | "model" | "default";

/** Effective status relative to a resolution date (today), for display only. */
export type SchemeStatus = "active" | "scheduled" | "ended";

/** The pre-resolved row the table renders — labels computed server-side. */
export type SchemeRowView = {
  id: string;
  scope: SchemeScope;
  /** Human label for the scope target, e.g. "Aria · OnlyFans (@aria_x)". */
  scopeLabel: string;
  model_percent: number;
  operator_percent: number;
  studio_percent: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  status: SchemeStatus;
  /** The one default scheme (both scope columns NULL) can never be deleted. */
  isDefault: boolean;
  /** Raw scope keys, carried for the edit dialog. */
  model_id: string | null;
  platform_account_id: string | null;
  /**
   * The scheme's rate card (025), ascending. Empty means the three-way split
   * above always applies — the pool behavior every scheme had before the card.
   */
  rates: RateRow[];
};

export const SCOPE_META: Record<SchemeScope, { badge: BadgeVariant; order: number }> = {
  account: { badge: "primary", order: 0 },
  model: { badge: "neutral", order: 1 },
  default: { badge: "muted", order: 2 },
};

export const STATUS_VARIANT: Record<SchemeStatus, BadgeVariant> = {
  active: "success",
  scheduled: "warning",
  ended: "muted",
};

/** Resolution order for the scope sections: most specific first. */
export const SCOPE_ORDER: SchemeScope[] = ["account", "model", "default"];

/**
 * "Per model · Aria", but just "Studio default" for the default scheme — whose
 * scope label and target label are the same words, and printing both reads as a
 * mistake. Used by every dialog that names a scheme in its header.
 */
export function schemeHeading(scopeLabel: string, targetLabel: string): string {
  return scopeLabel === targetLabel ? scopeLabel : `${scopeLabel} · ${targetLabel}`;
}

export function deriveScope(row: {
  model_id: string | null;
  platform_account_id: string | null;
}): SchemeScope {
  if (row.platform_account_id) return "account";
  if (row.model_id) return "model";
  return "default";
}

/**
 * Classifies a scheme's effective window against `todayIso` (a `YYYY-MM-DD`
 * string — lexicographic comparison is exact for ISO dates). `effective_to` is
 * the exclusive end boundary (docs/04 §4.9: the GiST exclusion uses a daterange),
 * so a scheme is `ended` on and after that date.
 */
export function deriveStatus(
  effectiveFrom: string,
  effectiveTo: string | null,
  todayIso: string,
): SchemeStatus {
  if (effectiveFrom > todayIso) return "scheduled";
  if (effectiveTo !== null && effectiveTo <= todayIso) return "ended";
  return "active";
}
