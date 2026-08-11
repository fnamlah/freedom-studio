import type { BadgeVariant } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

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

export const ACCOUNT_STATUS_META: Record<
  AccountStatus,
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: "success", label: "Active" },
  suspended: { variant: "warning", label: "Suspended" },
  closed: { variant: "muted", label: "Closed" },
};

export const ACCOUNT_STATUS_OPTIONS = ACCOUNT_STATUSES.map((value) => ({
  value,
  label: ACCOUNT_STATUS_META[value].label,
}));

/** Platform `is_active` rendered as a badge (docs/04 §4.4). */
export const PLATFORM_ACTIVE_META: Record<
  "active" | "inactive",
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "muted", label: "Inactive" },
};

export const PLATFORM_ACTIVE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];
