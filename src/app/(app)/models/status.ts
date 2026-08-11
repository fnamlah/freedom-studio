import type { BadgeVariant } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

/** `model_status` is shared by models and operators (docs/04 §4.2). */
export type ModelStatus = Database["public"]["Enums"]["model_status"];

export const MODEL_STATUSES: readonly ModelStatus[] = [
  "active",
  "inactive",
  "on_leave",
  "terminated",
] as const;

export const MODEL_STATUS_META: Record<
  ModelStatus,
  { variant: BadgeVariant; label: string }
> = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "muted", label: "Inactive" },
  on_leave: { variant: "warning", label: "On leave" },
  terminated: { variant: "danger", label: "Terminated" },
};

export const MODEL_STATUS_OPTIONS = MODEL_STATUSES.map((value) => ({
  value,
  label: MODEL_STATUS_META[value].label,
}));
