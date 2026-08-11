"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";

/**
 * URL-driven model filter (`?model=`), so the selection is shareable and survives
 * a refresh; the documents list page (force-dynamic) re-renders server-side.
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

  const options: SelectOption[] = [
    { value: "all", label: "All models" },
    ...models.map((m) => ({ value: m.id, label: m.stage_name })),
  ];

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">Filter</span>
      <Select
        aria-label="Filter documents by model"
        className="h-9 w-56"
        options={options}
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(next === "all" ? "/documents" : `/documents?model=${next}`);
          });
        }}
      />
    </label>
  );
}
