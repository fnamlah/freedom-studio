import type { BadgeVariant } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

/** `model_status` is deliberately reused for operators (docs/04 §4.3). */
export type OperatorStatus = Database["public"]["Enums"]["model_status"];

export const OPERATOR_STATUSES: readonly OperatorStatus[] = [
  "active",
  "inactive",
  "on_leave",
  "terminated",
] as const;

export const OPERATOR_STATUS_META: Record<
  OperatorStatus,
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "muted", label: "Inactive" },
  on_leave: { variant: "warning", label: "On leave" },
  terminated: { variant: "danger", label: "Terminated" },
};

export const OPERATOR_STATUS_OPTIONS = OPERATOR_STATUSES.map((value) => ({
  value,
  label: OPERATOR_STATUS_META[value].label,
}));

/** Where an assignment's date window sits relative to `today` (ISO YYYY-MM-DD). */
export type AssignmentActivity = "active" | "upcoming" | "ended";

export const ASSIGNMENT_ACTIVITY_META: Record<
  AssignmentActivity,
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: "success", label: "Active" },
  upcoming: { variant: "primary", label: "Upcoming" },
  ended: { variant: "muted", label: "Ended" },
};

/**
 * Classifies an assignment window against `today`. ISO date strings compare
 * lexicographically, so no Date parsing is needed. `assigned_to` is inclusive
 * (the DB constraint is `daterange(..., '[]')`, docs/04 §4.8).
 */
export function assignmentActivity(
  assignedFrom: string,
  assignedTo: string | null,
  today: string,
): AssignmentActivity {
  if (today < assignedFrom) return "upcoming";
  if (assignedTo !== null && today > assignedTo) return "ended";
  return "active";
}
