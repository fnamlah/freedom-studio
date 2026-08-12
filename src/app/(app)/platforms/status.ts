import type { BadgeVariant } from "@/components/ui/badge";
import type { SelectOption } from "@/components/ui/select";
import type { Database } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";

/**
 * `account_status` — the lifecycle of a model's account on a platform
 * (docs/04 §4.5). Distinct from `model_status`; a platform account is
 * `active`, `suspended`, or `closed`.
 */
export type AccountStatus = Database["public"]["Enums"]["account_status"];

export const ACCOUNT_STATUSES: readonly AccountStatus[] = [
  "active",
  "suspended",
  "closed",
] as const;

/** Badge colour only — labels come from `d.studio.accountStatus`. */
export const ACCOUNT_STATUS_VARIANT: Record<AccountStatus, BadgeVariant> = {
  active: "success",
  suspended: "warning",
  closed: "muted",
};

export function accountStatusMeta(
  d: Dictionary,
  status: AccountStatus,
): { variant: BadgeVariant; label: string } {
  return { variant: ACCOUNT_STATUS_VARIANT[status], label: d.studio.accountStatus[status] };
}

export function accountStatusOptions(d: Dictionary): SelectOption[] {
  return ACCOUNT_STATUSES.map((value) => ({
    value,
    label: d.studio.accountStatus[value],
  }));
}

/** Platform `is_active` rendered as a badge (docs/04 §4.4). */
export const PLATFORM_ACTIVE_VARIANT: Record<"active" | "inactive", BadgeVariant> = {
  active: "success",
  inactive: "muted",
};

export function platformActiveMeta(
  d: Dictionary,
  isActive: boolean,
): { variant: BadgeVariant; label: string } {
  const key = isActive ? "active" : "inactive";
  return { variant: PLATFORM_ACTIVE_VARIANT[key], label: d.studio.platformActive[key] };
}

export function platformActiveOptions(d: Dictionary): SelectOption[] {
  return [
    { value: "active", label: d.studio.platformActive.active },
    { value: "inactive", label: d.studio.platformActive.inactive },
  ];
}
