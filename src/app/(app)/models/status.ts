import type { BadgeVariant } from "@/components/ui/badge";
import type { SelectOption } from "@/components/ui/select";
import type { Database } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";

/** `model_status` is shared by models and operators (docs/04 §4.2). */
export type ModelStatus = Database["public"]["Enums"]["model_status"];

export const MODEL_STATUSES: readonly ModelStatus[] = [
  "active",
  "inactive",
  "on_leave",
  "terminated",
] as const;

/**
 * Only the badge colour lives here — a label is a translation, and a module-scope
 * constant is evaluated at import time where no locale exists. The label comes
 * from `d.studio.lifecycleStatus`, the ONE map shared with the operators module
 * (same Postgres enum, docs/04 §4.3).
 */
export const MODEL_STATUS_VARIANT: Record<ModelStatus, BadgeVariant> = {
  active: "success",
  inactive: "muted",
  on_leave: "warning",
  terminated: "danger",
};

export function modelStatusMeta(
  d: Dictionary,
  status: ModelStatus,
): { variant: BadgeVariant; label: string } {
  return { variant: MODEL_STATUS_VARIANT[status], label: d.studio.lifecycleStatus[status] };
}

export function modelStatusOptions(d: Dictionary): SelectOption[] {
  return MODEL_STATUSES.map((value) => ({
    value,
    label: d.studio.lifecycleStatus[value],
  }));
}
