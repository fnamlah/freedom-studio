import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Shared, client-safe vocabulary for commission schemes (docs/09 §4, docs/04 §4.9).
 *
 * A scheme applies at exactly one of three scopes; resolution walks them from most
 * to least specific — **account > model > default** — matching on the earning
 * row's `period_end` (docs/09 §4.1). This module holds the pure derivations and
 * display metadata so both the server page and the client table agree on labels,
 * badge colours, and effective-status classification.
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
};

export const SCOPE_META: Record<
  SchemeScope,
  { label: string; short: string; description: string; badge: BadgeVariant; order: number }
> = {
  account: {
    label: "Account-specific",
    short: "Account",
    description: "Overrides the model and default split for a single platform account.",
    badge: "primary",
    order: 0,
  },
  model: {
    label: "Model-specific",
    short: "Model",
    description: "Applies to every one of a model's accounts, unless an account scheme overrides it.",
    badge: "neutral",
    order: 1,
  },
  default: {
    label: "Studio default",
    short: "Default",
    description: "The base split. Exactly one always exists and it cannot be deleted.",
    badge: "muted",
    order: 2,
  },
};

export const STATUS_META: Record<SchemeStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: "Active", variant: "success" },
  scheduled: { label: "Scheduled", variant: "warning" },
  ended: { label: "Ended", variant: "muted" },
};

/** Resolution order for the scope sections: most specific first. */
export const SCOPE_ORDER: SchemeScope[] = ["account", "model", "default"];

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
