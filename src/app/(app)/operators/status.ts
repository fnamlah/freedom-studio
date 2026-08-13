import type { BadgeVariant } from "@/components/ui/badge";
import type { SelectOption } from "@/components/ui/select";
import type { Database } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";

/** `model_status` is deliberately reused for operators (docs/04 §4.3). */
export type OperatorStatus = Database["public"]["Enums"]["model_status"];

export const OPERATOR_STATUSES: readonly OperatorStatus[] = [
  "active",
  "inactive",
  "on_leave",
  "terminated",
] as const;

/**
 * The badge colours are the models module's map, re-exported rather than
 * repeated: same Postgres enum, same four states. The LABELS already came from
 * the one shared `d.studio.lifecycleStatus`; this was the last copy left.
 */
import { MODEL_STATUS_VARIANT } from "../models/status";

export { MODEL_STATUS_VARIANT as OPERATOR_STATUS_VARIANT };

export function operatorStatusMeta(
  d: Dictionary,
  status: OperatorStatus,
): { variant: BadgeVariant; label: string } {
  return { variant: MODEL_STATUS_VARIANT[status], label: d.studio.lifecycleStatus[status] };
}

export function operatorStatusOptions(d: Dictionary): SelectOption[] {
  return OPERATOR_STATUSES.map((value) => ({
    value,
    label: d.studio.lifecycleStatus[value],
  }));
}

/** Where an assignment's date window sits relative to `today` (ISO YYYY-MM-DD). */
export type AssignmentActivity = "active" | "upcoming" | "ended";

export const ASSIGNMENT_ACTIVITY_VARIANT: Record<AssignmentActivity, BadgeVariant> = {
  active: "success",
  upcoming: "primary",
  ended: "muted",
};

export function assignmentActivityMeta(
  d: Dictionary,
  activity: AssignmentActivity,
): { variant: BadgeVariant; label: string } {
  return {
    variant: ASSIGNMENT_ACTIVITY_VARIANT[activity],
    label: d.studio.assignmentActivity[activity],
  };
}

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
