"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { createEarning, updateEarning } from "./actions";

/** Model choices for the picker. */
export type ModelOption = { id: string; stage_name: string };

/** Platform-account choices, pre-labelled and scoped to their owning model. */
export type AccountOption = {
  id: string;
  model_id: string;
  label: string;
  platform_fee_percent: number | null;
  status: string;
};

/** The subset of an earnings row the edit dialog rehydrates. */
export type EditableEarning = {
  id: string;
  model_id: string;
  platform_account_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  platform_fee_amount: number;
  net_amount: number;
  currency: string;
};

type FormState = {
  model_id: string;
  platform_account_id: string;
  period_start: string;
  period_end: string;
  gross_amount: string;
  platform_fee_amount: string;
  net_amount: string;
  currency: string;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function amountString(n: number): string {
  return Number.isFinite(n) ? String(round2(Math.max(0, n))) : "";
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function initialState(earning?: EditableEarning): FormState {
  return {
    model_id: earning?.model_id ?? "",
    platform_account_id: earning?.platform_account_id ?? "",
    period_start: earning?.period_start ?? "",
    period_end: earning?.period_end ?? "",
    gross_amount: earning?.gross_amount !== undefined ? String(earning.gross_amount) : "",
    platform_fee_amount:
      earning?.platform_fee_amount !== undefined ? String(earning.platform_fee_amount) : "0",
    net_amount: earning?.net_amount !== undefined ? String(earning.net_amount) : "",
    currency: earning?.currency ?? "USD",
  };
}

/**
 * Create/edit dialog for an earnings statement (one row per account per period).
 *
 * Convenience wiring: picking an account with a known `platform_fee_percent`
 * pre-fills the fee from the gross, and `net = gross − fee` is kept in sync — until
 * the user edits fee or net by hand (then that field is left alone). All three are
 * still editable and the server re-validates. The model picker only scopes which
 * accounts are offered; the server derives the authoritative `model_id` from the
 * account (docs/04 §4.7).
 */
export function EarningForm({
  mode,
  models,
  accounts,
  earning,
}: {
  mode: "create" | "edit";
  models: ModelOption[];
  accounts: AccountOption[];
  earning?: EditableEarning;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(earning));
  // Once the user hand-edits fee / net, stop auto-deriving that field.
  const [feeTouched, setFeeTouched] = useState(false);
  const [netTouched, setNetTouched] = useState(false);
  const d = useDict();
  const fm = fmt(useLocale());

  const isCreate = mode === "create";
  const noAccounts = accounts.length === 0;

  const modelOptions: SelectOption[] = useMemo(
    () => models.map((m) => ({ value: m.id, label: m.stage_name })),
    [models],
  );

  const accountOptions: SelectOption[] = useMemo(() => {
    if (!form.model_id) return [];
    return accounts
      .filter((a) => a.model_id === form.model_id)
      .map((a) => ({ value: a.id, label: a.label }));
  }, [accounts, form.model_id]);

  const selectedAccount = accounts.find((a) => a.id === form.platform_account_id) ?? null;
  const netPreview = num(form.net_amount);

  function openDialog() {
    setForm(initialState(earning));
    setFeeTouched(false);
    setNetTouched(false);
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function selectModel(next: string) {
    setForm((prev) => ({ ...prev, model_id: next, platform_account_id: "" }));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Recompute fee (from account %) and net (gross − fee) where not hand-edited. */
  function recompute(next: FormState, account: AccountOption | null): FormState {
    const gross = num(next.gross_amount);
    let fee = num(next.platform_fee_amount);
    if (!feeTouched && account && account.platform_fee_percent !== null) {
      fee = round2((gross * account.platform_fee_percent) / 100);
      next.platform_fee_amount = amountString(fee);
    }
    if (!netTouched) {
      next.net_amount = amountString(gross - fee);
    }
    return next;
  }

  function onGrossChange(value: string) {
    setForm((prev) => recompute({ ...prev, gross_amount: value }, selectedAccount));
  }

  function onFeeChange(value: string) {
    setFeeTouched(true);
    setForm((prev) => {
      const next = { ...prev, platform_fee_amount: value };
      if (!netTouched) next.net_amount = amountString(num(next.gross_amount) - num(value));
      return next;
    });
  }

  function onNetChange(value: string) {
    setNetTouched(true);
    set("net_amount", value);
  }

  function onAccountChange(id: string) {
    const account = accounts.find((a) => a.id === id) ?? null;
    setForm((prev) => recompute({ ...prev, platform_account_id: id }, account));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const payload = {
        platform_account_id: form.platform_account_id,
        period_start: form.period_start,
        period_end: form.period_end,
        gross_amount: form.gross_amount,
        platform_fee_amount: form.platform_fee_amount,
        net_amount: form.net_amount,
        currency: form.currency,
      };

      const result = isCreate
        ? await createEarning(payload)
        : await updateEarning({ id: earning!.id, ...payload });

      if (result.ok) {
        success(
          isCreate ? d.studio.earnings.toastCreated : d.studio.earnings.toastUpdated,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate
            ? d.studio.earnings.toastCreateFailed
            : d.studio.earnings.toastUpdateFailed,
          result.error,
        );
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>{d.studio.earnings.recordStatement}</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          {d.common.edit}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? d.studio.earnings.createTitle : d.studio.earnings.editTitle}
        description={d.studio.earnings.dialogDescription}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="earning-form" loading={isRunning} disabled={noAccounts}>
              {isCreate ? d.studio.earnings.submitCreate : d.studio.earnings.submitEdit}
            </Button>
          </>
        }
      >
        {noAccounts ? (
          <p className="text-sm text-muted">{d.studio.earnings.noAccounts}</p>
        ) : (
          <form id="earning-form" onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help={d.studio.earnings.helpModel}>
                <Label htmlFor="earning-model" required>
                  {d.studio.earnings.fieldModel}
                </Label>
                <Select
                  id="earning-model"
                  required
                  placeholder={d.studio.earnings.selectModel}
                  options={modelOptions}
                  value={form.model_id}
                  onChange={(e) => selectModel(e.target.value)}
                />
              </Field>

              <Field
                help={
                  selectedAccount && selectedAccount.platform_fee_percent !== null
                    ? d.studio.earnings.helpFeePrefill(
                        fm.percent(selectedAccount.platform_fee_percent),
                      )
                    : form.model_id && accountOptions.length === 0
                      ? d.studio.earnings.helpNoAccounts
                      : undefined
                }
              >
                <Label htmlFor="earning-account" required>
                  {d.studio.earnings.fieldAccount}
                </Label>
                <Select
                  id="earning-account"
                  required
                  disabled={!form.model_id || accountOptions.length === 0}
                  placeholder={
                    form.model_id
                      ? d.studio.earnings.selectAccount
                      : d.studio.earnings.chooseModelFirst
                  }
                  options={accountOptions}
                  value={form.platform_account_id}
                  onChange={(e) => onAccountChange(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="earning-period-start" required>
                  {d.studio.earnings.fieldPeriodStart}
                </Label>
                <Input
                  id="earning-period-start"
                  type="date"
                  required
                  value={form.period_start}
                  onChange={(e) => set("period_start", e.target.value)}
                />
              </Field>

              <Field>
                <Label htmlFor="earning-period-end" required>
                  {d.studio.earnings.fieldPeriodEnd}
                </Label>
                <Input
                  id="earning-period-end"
                  type="date"
                  required
                  value={form.period_end}
                  onChange={(e) => set("period_end", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field help={d.studio.earnings.helpGross}>
                <Label htmlFor="earning-gross" required hint={d.studio.earnings.hintAmount}>
                  {d.studio.earnings.fieldGross}
                </Label>
                <Input
                  id="earning-gross"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={form.gross_amount}
                  onChange={(e) => onGrossChange(e.target.value)}
                />
              </Field>

              <Field help={d.studio.earnings.helpFee}>
                <Label htmlFor="earning-fee" hint={d.studio.earnings.hintAmount}>
                  {d.studio.earnings.fieldFee}
                </Label>
                <Input
                  id="earning-fee"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.platform_fee_amount}
                  onChange={(e) => onFeeChange(e.target.value)}
                />
              </Field>

              <Field help={d.studio.earnings.helpNet}>
                <Label htmlFor="earning-net" required hint={d.studio.earnings.hintAmount}>
                  {d.studio.earnings.fieldNet}
                </Label>
                <Input
                  id="earning-net"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={form.net_amount}
                  onChange={(e) => onNetChange(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help={d.studio.earnings.helpCurrency}>
                <Label htmlFor="earning-currency" required>
                  {d.studio.earnings.fieldCurrency}
                </Label>
                <Input
                  id="earning-currency"
                  autoComplete="off"
                  maxLength={3}
                  required
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="uppercase"
                />
              </Field>

              <div className="flex items-end">
                <p className="text-xs text-muted">
                  {d.studio.earnings.netPreview}{" "}
                  <span className="font-medium text-foreground">
                    {fm.money(netPreview, form.currency || "USD")}
                  </span>
                </p>
              </div>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
