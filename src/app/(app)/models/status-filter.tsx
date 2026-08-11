"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";
import { MODEL_STATUS_OPTIONS } from "./status";

const OPTIONS: SelectOption[] = [{ value: "all", label: "All statuses" }, ...MODEL_STATUS_OPTIONS];

/**
 * URL-driven status filter. Writes `?status=` so the selection is shareable and
 * survives a refresh; the list page (force-dynamic) re-renders server-side.
 */
export function StatusFilter({ current }: { current: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">Filter</span>
      <Select
        aria-label="Filter models by status"
        className="h-9 w-44"
        options={OPTIONS}
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(next === "all" ? "/models" : `/models?status=${next}`);
          });
        }}
      />
    </label>
  );
}
