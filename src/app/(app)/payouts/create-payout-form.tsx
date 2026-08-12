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
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

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
  const d = useDict();
  const fm = fmt(useLocale());
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
        success(d.money.payouts.createToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.payouts.createToastErr, result.error);
      }
    });
  }

  const noPayees = payees.length === 0;

  return (
    <>
      <Button onClick={openDialog}>{d.money.payouts.createCta}</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.money.payouts.createTitle}
        description={d.money.payouts.createDesc}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="create-payout-form" loading={isRunning} disabled={noPayees}>
              {d.money.payouts.createCta}
            </Button>
          </>
        }
      >
        {noPayees ? (
          <p className="text-sm text-muted">{d.money.payouts.createNoPayees}</p>
        ) : (
          <form id="create-payout-form" onSubmit={submit} className="flex flex-col gap-4">
            <Field
              help={
                selectedBalance
                  ? d.money.payouts.createOutstanding(
                      fm.money(selectedBalance.balance, selectedBalance.currency),
                    )
                  : d.money.payouts.createPayeeHelp
              }
            >
              <Label htmlFor="payout-payee" required>
                {d.money.payouts.colPayee}
              </Label>
              <Select
                id="payout-payee"
                required
                placeholder={d.money.payouts.createSelectPayee}
                options={payeeOptions}
                value={form.payee}
                onChange={(e) => set("payee", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="payout-start" required>
                  {d.money.payouts.createPeriodStart}
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
                  {d.money.payouts.createPeriodEnd}
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
              <Field help={d.money.payouts.createGrossHelp}>
                <Label
                  htmlFor="payout-gross"
                  required
                  hint={d.money.payouts.createHintNonNegative}
                >
                  {d.money.payouts.createGross}
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
              <Field help={d.money.payouts.createFeeHelp}>
                <Label htmlFor="payout-fee" hint={d.money.payouts.createHintNonNegative}>
                  {d.money.payouts.createFee}
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
              <Field help={d.money.payouts.createDeductionsHelp}>
                <Label htmlFor="payout-deductions" hint={d.money.payouts.createHintNonNegative}>
                  {d.money.payouts.createDeductions}
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
              <Field help={d.money.payouts.createNetHelp}>
                <Label htmlFor="payout-net" required hint={d.money.payouts.createHintNonNegative}>
                  {d.money.payouts.createNet}
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
              <Field help={d.money.payouts.createCurrencyHelp}>
                <Label htmlFor="payout-currency" required>
                  {d.money.payouts.createCurrency}
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
              <Field help={d.money.payouts.createMethodHelp}>
                <Label htmlFor="payout-method">{d.money.payouts.createMethod}</Label>
                <Input
                  id="payout-method"
                  autoComplete="off"
                  value={form.payment_method}
                  onChange={(e) => set("payment_method", e.target.value)}
                  placeholder={d.money.payouts.createMethodPlaceholder}
                />
              </Field>
              <div className="flex items-end">
                <p className="text-xs text-muted">
                  {d.money.payouts.createNetPreview(
                    fm.money(num(form.net_amount), form.currency || "USD"),
                  )}
                </p>
              </div>
            </div>

            <Field help={d.money.payouts.createNotesHelp}>
              <Label htmlFor="payout-notes">{d.common.notes}</Label>
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
