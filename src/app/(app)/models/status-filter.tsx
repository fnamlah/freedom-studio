"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";
import { useDict } from "@/lib/i18n/client";
import { modelStatusOptions } from "./status";

/**
 * URL-driven status filter. Writes `?status=` so the selection is shareable and
 * survives a refresh; the list page (force-dynamic) re-renders server-side.
 */
export function StatusFilter({ current }: { current: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const d = useDict();

  const options: SelectOption[] = [
    { value: "all", label: d.studio.models.allStatuses },
    ...modelStatusOptions(d),
  ];

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">{d.studio.models.filterLabel}</span>
      <Select
        aria-label={d.studio.models.filterAria}
        className="h-9 w-44"
        options={options}
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
