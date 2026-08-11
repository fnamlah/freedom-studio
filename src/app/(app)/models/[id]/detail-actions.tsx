"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

import { setModelStatus } from "../actions";
import { MODEL_STATUS_OPTIONS, type ModelStatus } from "../status";

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

  function change(next: ModelStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await setModelStatus({ id, status: next });
      if (result.ok) {
        success("Status changed", result.message);
        router.refresh();
      } else {
        setValue(previous);
        error("Could not change status", result.error);
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">Status</span>
      <Select
        aria-label="Change model status"
        className="h-9 w-40"
        options={MODEL_STATUS_OPTIONS}
        value={value}
        disabled={isRunning}
        onChange={(e) => change(e.target.value as ModelStatus)}
      />
    </label>
  );
}
