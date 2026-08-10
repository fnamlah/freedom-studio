"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { money } from "@/lib/format";

import { createPayout } from "./actions";

export type PayeePickOption = {
  payee_type: "model" | "operator";
  payee_id: string;
  label: string;
};

/** Current outstanding balance per payee, keyed `${payee_type}:${payee_id}`. */
export type PayeeBalance = { balance: number; currency: string };

type FormState = {
  payee: string;
  period_start: string;
  period_end: string;
  gross_amount: string;
  studio_fee_amount: string;
  deductions: string;
  net_amount: string;
  currency: string;
  payment_method: string;
  notes: string;
};

const INITIAL: FormState = {
  payee: "",
  period_start: "",
  period_end: "",
  gross_amount: "",
  studio_fee_amount: "0",
  deductions: "0",
  net_amount: "",
  currency: "USD",
  payment_method: "",
  notes: "",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function amountString(n: number): string {
  return Number.isFinite(n) ? String(round2(Math.max(0, n))) : "";
}

/**
 * Create a `pending` payout. `net = gross − studio fee − deductions` is kept in
 * sync until the finance user edits net by hand. The payee's current outstanding
 * balance (from `v_payee_balances`) is shown as guidance. Approval and settlement
 * are separate, role-gated steps (docs/09 §6).
 */
export function CreatePayoutForm({
  payees,
  balances,
}: {
  payees: PayeePickOption[];
  balances: Record<string, PayeeBalance>;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [netTouched, setNetTouched] = useState(false);

  const payeeOptions: SelectOption[] = useMemo(
    () => payees.map((p) => ({ value: `${p.payee_type}:${p.payee_id}`, label: p.label })),
    [payees],
  );

  const selectedBalance = form.payee ? balances[form.payee] : undefined;

  function openDialog() {
    setForm(INITIAL);
    setNetTouched(false);
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function recompute(next: FormState): FormState {
    if (!netTouched) {
      const net = num(next.gross_amount) - num(next.studio_fee_amount) - num(next.deductions);
      next.net_amount = amountString(net);
    }
    return next;
  }

  function onMoneyChange(key: "gross_amount" | "studio_fee_amount" | "deductions", value: string) {
    setForm((prev) => recompute({ ...prev, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [payee_type, payee_id] = form.payee.split(":");

    startTransition(async () => {
      const result = await createPayout({
        payee_type: payee_type as "model" | "operator",
        payee_id: payee_id ?? "",
        period_start: form.period_start,
        period_end: form.period_end,
        gross_amount: form.gross_amount,
        studio_fee_amount: form.studio_fee_amount,
        deductions: form.deductions,
        net_amount: form.net_amount,
        currency: form.currency,
        payment_method: form.payment_method,
        notes: form.notes,
      });

      if (result.ok) {
        success("Payout created", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not create payout", result.error);
      }
    });
  }

  const noPayees = payees.length === 0;

  return (
    <>
      <Button onClick={openDialog}>Create payout</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Create a payout"
        description="Creates a pending payout. A Super Admin approves it, then finance records settlement — which posts the ledger entry automatically (docs/09 §6)."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="create-payout-form" loading={isRunning} disabled={noPayees}>
              Create payout
            </Button>
          </>
        }
      >
        {noPayees ? (
          <p className="text-sm text-muted">
            No payees are available. Add a model or operator first — every payout targets exactly
            one payee.
          </p>
        ) : (
          <form id="create-payout-form" onSubmit={submit} className="flex flex-col gap-4">
            <Field
              help={
                selectedBalance
                  ? `Outstanding balance: ${money(selectedBalance.balance, selectedBalance.currency)}`
                  : "Money is owed to a model or operator — never the studio (docs/09 §1)."
              }
            >
              <Label htmlFor="payout-payee" required>
                Payee
              </Label>
              <Select
                id="payout-payee"
                required
                placeholder="Select a payee…"
                options={payeeOptions}
                value={form.payee}
                onChange={(e) => set("payee", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="payout-start" required>
                  Period start
                </Label>
                <Input
                  id="payout-start"
                  type="date"
                  required
                  value={form.period_start}
                  onChange={(e) => set("period_start", e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="payout-end" required>
                  Period end
                </Label>
                <Input
                  id="payout-end"
                  type="date"
                  required
                  value={form.period_end}
                  onChange={(e) => set("period_end", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field help="Amount owed for the period.">
                <Label htmlFor="payout-gross" required hint="≥ 0">
                  Gross
                </Label>
                <Input
                  id="payout-gross"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={form.gross_amount}
                  onChange={(e) => onMoneyChange("gross_amount", e.target.value)}
                />
              </Field>
              <Field help="Studio processing fee, if any.">
                <Label htmlFor="payout-fee" hint="≥ 0">
                  Studio fee
                </Label>
                <Input
                  id="payout-fee"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.studio_fee_amount}
                  onChange={(e) => onMoneyChange("studio_fee_amount", e.target.value)}
                />
              </Field>
              <Field help="Withheld from this payout.">
                <Label htmlFor="payout-deductions" hint="≥ 0">
                  Deductions
                </Label>
                <Input
                  id="payout-deductions"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.deductions}
                  onChange={(e) => onMoneyChange("deductions", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help="Gross − studio fee − deductions. Editable.">
                <Label htmlFor="payout-net" required hint="≥ 0">
                  Net payable
                </Label>
                <Input
                  id="payout-net"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={form.net_amount}
                  onChange={(e) => {
                    setNetTouched(true);
                    set("net_amount", e.target.value);
                  }}
                />
              </Field>
              <Field help="3-letter code, e.g. USD.">
                <Label htmlFor="payout-currency" required>
                  Currency
                </Label>
                <Input
                  id="payout-currency"
                  autoComplete="off"
                  maxLength={3}
                  required
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="uppercase"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help="Optional — bank, wallet, etc.">
                <Label htmlFor="payout-method">Payment method</Label>
                <Input
                  id="payout-method"
                  autoComplete="off"
                  value={form.payment_method}
                  onChange={(e) => set("payment_method", e.target.value)}
                  placeholder="e.g. Wise transfer"
                />
              </Field>
              <div className="flex items-end">
                <p className="text-xs text-muted">
                  Net payable:{" "}
                  <span className="font-medium text-foreground">
                    {money(num(form.net_amount), form.currency || "USD")}
                  </span>
                </p>
              </div>
            </div>

            <Field help="Optional. Context for approver and audit trail.">
              <Label htmlFor="payout-notes">Notes</Label>
              <Textarea
                id="payout-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </form>
        )}
      </Dialog>
    </>
  );
}
