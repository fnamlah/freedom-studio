"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";
import { useDict } from "@/lib/i18n/client";

/**
 * URL-driven model filter (`?model=`), so the selection is shareable and survives
 * a refresh; the list page (force-dynamic) re-renders server-side.
 */
export function ModelFilter({
  current,
  models,
}: {
  current: string;
  models: { id: string; stage_name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const d = useDict();

  const options: SelectOption[] = [
    { value: "all", label: d.studio.earnings.allModels },
    ...models.map((m) => ({ value: m.id, label: m.stage_name })),
  ];

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">{d.studio.earnings.filterLabel}</span>
      <Select
        aria-label={d.studio.earnings.filterAria}
        className="h-9 w-56"
        options={options}
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(next === "all" ? "/earnings" : `/earnings?model=${next}`);
          });
        }}
      />
    </label>
  );
}
