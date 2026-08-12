"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, type SelectOption } from "@/components/ui/select";
import { useDict } from "@/lib/i18n/client";

/** A payee choice, addressed by the polymorphic `type:id` pair (docs/09 §5.4). */
export type PayeeOption = {
  /** Encoded as `${payee_type}:${payee_id}` for the URL param. */
  value: string;
  label: string;
};

/**
 * URL-driven payee filter (`?payee=model:<uuid>`), so the selection is shareable
 * and survives a refresh; the list page (force-dynamic) re-renders server-side and
 * RLS scopes what each caller may see.
 */
export function PayeeFilter({
  current,
  payees,
  basePath = "/ledger",
}: {
  current: string;
  payees: PayeeOption[];
  basePath?: string;
}) {
  const router = useRouter();
  const d = useDict();
  const [isPending, startTransition] = useTransition();

  const options: SelectOption[] = [
    { value: "all", label: d.money.ledger.allPayees },
    ...payees,
  ];

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="whitespace-nowrap">{d.money.ledger.payee}</span>
      <Select
        aria-label={d.money.ledger.filterAria}
        className="h-9 w-64"
        options={options}
        value={current}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.push(
              next === "all" ? basePath : `${basePath}?payee=${encodeURIComponent(next)}`,
            );
          });
        }}
      />
    </label>
  );
}
