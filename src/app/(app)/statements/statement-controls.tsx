"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useDict } from "@/lib/i18n/client";

export type PayeeOption = { value: string; label: string };

/**
 * Statement picker — payee + `[from, to]` window, URL-driven so a generated
 * statement is shareable and reproducible (the append-only ledger makes a past
 * period reproducible forever, docs/09 §7). Submitting pushes the params; the page
 * renders `fn_payee_statement` server-side under the caller's own RLS.
 */
export function StatementControls({
  payees,
  current,
}: {
  payees: PayeeOption[];
  current: { payee: string; from: string; to: string };
}) {
  const router = useRouter();
  const d = useDict();
  const [isPending, startTransition] = useTransition();
  const [payee, setPayee] = useState(current.payee);
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);

  const payeeOptions: SelectOption[] = [
    { value: "", label: d.money.statements.selectPayee },
    ...payees,
  ];

  const canGenerate = payee !== "" && from !== "" && to !== "";

  function generate() {
    if (!canGenerate) return;
    const params = new URLSearchParams({ payee, from, to });
    startTransition(() => {
      router.push(`/statements?${params.toString()}`);
    });
  }

  function clear() {
    setPayee("");
    setFrom("");
    setTo("");
    startTransition(() => {
      router.push("/statements");
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <Field>
          <Label htmlFor="stmt-payee" required>
            {d.money.statements.payee}
          </Label>
          <Select
            id="stmt-payee"
            options={payeeOptions}
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor="stmt-from" required>
            {d.money.statements.from}
          </Label>
          <Input
            id="stmt-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor="stmt-to" required>
            {d.money.statements.to}
          </Label>
          <Input id="stmt-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button onClick={generate} loading={isPending} disabled={!canGenerate} fullWidth>
            {d.money.statements.generate}
          </Button>
          <Button variant="ghost" onClick={clear} disabled={isPending}>
            {d.common.clear}
          </Button>
        </div>
      </div>
    </div>
  );
}
