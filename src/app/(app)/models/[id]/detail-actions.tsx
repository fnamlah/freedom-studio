"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { setModelStatus } from "../actions";
import { modelStatusOptions, type ModelStatus } from "../status";

/**
 * Inline lifecycle-status control. A change fires the dedicated `setModelStatus`
 * action (audited as `model.status_change`) — kept separate from profile edits so
 * status transitions are individually auditable. Reverts on failure.
 */
export function StatusControl({
  id,
  status,
}: {
  id: string;
  status: ModelStatus;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [value, setValue] = useState<ModelStatus>(status);
  const [isRunning, startTransition] = useTransition();
  const d = useDict();

  function change(next: ModelStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await setModelStatus({ id, status: next });
      if (result.ok) {
        success(d.studio.models.toastStatusChanged, result.message);
        router.refresh();
      } else {
        setValue(previous);
        error(d.studio.models.toastStatusFailed, result.error);
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">{d.studio.models.statusControlLabel}</span>
      <Select
        aria-label={d.studio.models.statusControlAria}
        className="h-9 w-40"
        options={modelStatusOptions(d)}
        value={value}
        disabled={isRunning}
        onChange={(e) => change(e.target.value as ModelStatus)}
      />
    </label>
  );
}
