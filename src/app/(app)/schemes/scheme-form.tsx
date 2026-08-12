"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { toNumber } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { createScheme, updateScheme } from "./actions";
import { SCOPE_META, type SchemeScope } from "./scheme-meta";

/** The subset of columns the edit dialog reads/writes. */
export type EditableScheme = {
  id: string;
  scope: SchemeScope;
  scopeLabel: string;
  model_percent: number;
  operator_percent: number;
  studio_percent: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
};

type FormState = {
  scope: SchemeScope;
  model_id: string;
  platform_account_id: string;
  model_percent: string;
  operator_percent: string;
  studio_percent: string;
  effective_from: string;
  effective_to: string;
  notes: string;
};

function initialCreateState(): FormState {
  return {
    scope: "default",
    model_id: "",
    platform_account_id: "",
    model_percent: "70",
    operator_percent: "10",
    studio_percent: "20",
    effective_from: "",
    effective_to: "",
    notes: "",
  };
}

function initialEditState(scheme: EditableScheme): FormState {
  return {
    scope: scheme.scope,
    model_id: "",
    platform_account_id: "",
    model_percent: String(scheme.model_percent),
    operator_percent: String(scheme.operator_percent),
    studio_percent: String(scheme.studio_percent),
    effective_from: scheme.effective_from,
    effective_to: scheme.effective_to ?? "",
    notes: scheme.notes ?? "",
  };
}

/**
 * Create/edit dialog for a commission scheme (Super Admin only — the trigger is
 * rendered only where `canWrite` holds). Self-contained: renders its own trigger.
 *
 * - `mode="create"` collects the scope (default / model / account) plus, for the
 *   non-default scopes, the specific target.
 * - `mode="edit"` locks the scope — a scheme's scope is its identity (docs/09
 *   §4.2). Changing a split means either editing this scheme's window or closing
 *   it (set effective-to) and adding a successor; both are done here.
 *
 * The three percentages must total exactly 100% — surfaced live below the inputs
 * and enforced authoritatively by the server action + the DB CHECK (docs/04 §4.9).
 */
export function SchemeForm({
  mode,
  scheme,
  modelOptions = [],
  accountOptions = [],
}: {
  mode: "create" | "edit";
  scheme?: EditableScheme;
  /** Only needed in create mode. */
  modelOptions?: SelectOption[];
  accountOptions?: SelectOption[];
}) {
  const router = useRouter();
  const d = useDict();
  const fm = fmt(useLocale());
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && scheme ? initialEditState(scheme) : initialCreateState(),
  );

  const isCreate = mode === "create";

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }) as FormState);
  }

  function openDialog() {
    setForm(mode === "edit" && scheme ? initialEditState(scheme) : initialCreateState());
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  const sum = useMemo(() => {
    const m = toNumber(form.model_percent) ?? 0;
    const o = toNumber(form.operator_percent) ?? 0;
    const s = toNumber(form.studio_percent) ?? 0;
    return Math.round((m + o + s) * 100) / 100;
  }, [form.model_percent, form.operator_percent, form.studio_percent]);

  const sumOk = sum === 100;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const result = isCreate
        ? await createScheme({
            scope: form.scope,
            model_id: form.scope === "model" ? form.model_id : null,
            platform_account_id: form.scope === "account" ? form.platform_account_id : null,
            model_percent: form.model_percent,
            operator_percent: form.operator_percent,
            studio_percent: form.studio_percent,
            effective_from: form.effective_from,
            effective_to: form.effective_to,
            notes: form.notes,
          })
        : await updateScheme({
            id: scheme!.id,
            model_percent: form.model_percent,
            operator_percent: form.operator_percent,
            studio_percent: form.studio_percent,
            effective_from: form.effective_from,
            effective_to: form.effective_to,
            notes: form.notes,
          });

      if (result.ok) {
        success(
          isCreate ? d.money.schemes.formAddToastOk : d.money.schemes.formEditToastOk,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate ? d.money.schemes.formAddToastErr : d.money.schemes.formEditToastErr,
          result.error,
        );
      }
    });
  }

  const scopeOptions: SelectOption[] = [
    { value: "default", label: d.money.schemes.scope.default.label },
    { value: "model", label: d.money.schemes.scope.model.label },
    { value: "account", label: d.money.schemes.scope.account.label },
  ];

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>{d.money.schemes.formNewCta}</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          {d.common.edit}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? d.money.schemes.formAddTitle : d.money.schemes.formEditTitle}
        description={isCreate ? d.money.schemes.formAddDesc : d.money.schemes.formEditDesc}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="scheme-form" loading={isRunning} disabled={!sumOk}>
              {isCreate ? d.money.schemes.formAddSubmit : d.money.schemes.formSaveSubmit}
            </Button>
          </>
        }
      >
        <form id="scheme-form" onSubmit={submit} className="flex flex-col gap-4">
          {/* -------------------------------------------------------- scope --- */}
          {isCreate ? (
            <>
              <Field help={d.money.schemes.scope[form.scope].description}>
                <Label htmlFor="scheme-scope" required>
                  {d.money.schemes.formScope}
                </Label>
                <Select
                  id="scheme-scope"
                  options={scopeOptions}
                  value={form.scope}
                  onChange={(e) => field("scope")(e.target.value as SchemeScope)}
                />
              </Field>

              {form.scope === "model" ? (
                <Field help={d.money.schemes.formModelHelp}>
                  <Label htmlFor="scheme-model" required>
                    {d.money.schemes.formModel}
                  </Label>
                  <Select
                    id="scheme-model"
                    placeholder={d.money.schemes.formSelectModel}
                    required
                    options={modelOptions}
                    value={form.model_id}
                    onChange={(e) => field("model_id")(e.target.value)}
                  />
                </Field>
              ) : null}

              {form.scope === "account" ? (
                <Field help={d.money.schemes.formAccountHelp}>
                  <Label htmlFor="scheme-account" required>
                    {d.money.schemes.formAccount}
                  </Label>
                  <Select
                    id="scheme-account"
                    placeholder={d.money.schemes.formSelectAccount}
                    required
                    options={accountOptions}
                    value={form.platform_account_id}
                    onChange={(e) => field("platform_account_id")(e.target.value)}
                  />
                </Field>
              ) : null}
            </>
          ) : scheme ? (
            <Field help={d.money.schemes.formScopeLockedHelp}>
              <Label>{d.money.schemes.formScope}</Label>
              <div className="flex items-center gap-2">
                <Badge variant={SCOPE_META[scheme.scope].badge}>
                  {d.money.schemes.scope[scheme.scope].label}
                </Badge>
                <span className="text-sm text-muted">{scheme.scopeLabel}</span>
              </div>
            </Field>
          ) : null}

          {/* ------------------------------------------------------- splits --- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <Label htmlFor="scheme-model-pct" required hint={d.money.schemes.formPctHint}>
                {d.money.schemes.formModelPct}
              </Label>
              <Input
                id="scheme-model-pct"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                required
                value={form.model_percent}
                onChange={(e) => field("model_percent")(e.target.value)}
              />
            </Field>

            <Field>
              <Label
                htmlFor="scheme-operator-pct"
                required
                hint={d.money.schemes.formOperatorPctHint}
              >
                {d.money.schemes.formOperatorPct}
              </Label>
              <Input
                id="scheme-operator-pct"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                required
                value={form.operator_percent}
                onChange={(e) => field("operator_percent")(e.target.value)}
              />
            </Field>

            <Field>
              <Label htmlFor="scheme-studio-pct" required hint={d.money.schemes.formPctHint}>
                {d.money.schemes.formStudioPct}
              </Label>
              <Input
                id="scheme-studio-pct"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                required
                value={form.studio_percent}
                onChange={(e) => field("studio_percent")(e.target.value)}
              />
            </Field>
          </div>

          <div
            className={
              sumOk
                ? "flex items-center justify-between rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
                : "flex items-center justify-between rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            }
          >
            <span>{d.money.schemes.formSumRule}</span>
            <span className="font-semibold tabular-nums">{fm.percent(sum)}</span>
          </div>

          {/* ----------------------------------------------- effective dates --- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help={d.money.schemes.formEffectiveFromHelp}>
              <Label htmlFor="scheme-from" required>
                {d.money.schemes.formEffectiveFrom}
              </Label>
              <Input
                id="scheme-from"
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => field("effective_from")(e.target.value)}
              />
            </Field>

            <Field help={d.money.schemes.formEffectiveToHelp}>
              <Label htmlFor="scheme-to">{d.money.schemes.formEffectiveTo}</Label>
              <Input
                id="scheme-to"
                type="date"
                value={form.effective_to}
                min={form.effective_from || undefined}
                onChange={(e) => field("effective_to")(e.target.value)}
              />
            </Field>
          </div>

          <Field help={d.money.schemes.formNotesHelp}>
            <Label htmlFor="scheme-notes">{d.common.notes}</Label>
            <Textarea
              id="scheme-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder={d.money.schemes.formNotesPlaceholder}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
