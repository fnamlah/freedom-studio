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
        success(isCreate ? "Scheme added" : "Scheme updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(isCreate ? "Could not add scheme" : "Could not update scheme", result.error);
      }
    });
  }

  const scopeOptions: SelectOption[] = [
    { value: "default", label: SCOPE_META.default.label },
    { value: "model", label: SCOPE_META.model.label },
    { value: "account", label: SCOPE_META.account.label },
  ];

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>New scheme</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? "Add a commission scheme" : "Edit commission scheme"}
        description={
          isCreate
            ? "Split studio net revenue three ways. Resolution runs account → model → default; the most specific effective scheme wins."
            : "Adjust this scheme's split or effective window. Its scope is fixed — a different scope is a different scheme."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="scheme-form" loading={isRunning} disabled={!sumOk}>
              {isCreate ? "Add scheme" : "Save changes"}
            </Button>
          </>
        }
      >
        <form id="scheme-form" onSubmit={submit} className="flex flex-col gap-4">
          {/* -------------------------------------------------------- scope --- */}
          {isCreate ? (
            <>
              <Field help={SCOPE_META[form.scope].description}>
                <Label htmlFor="scheme-scope" required>
                  Scope
                </Label>
                <Select
                  id="scheme-scope"
                  options={scopeOptions}
                  value={form.scope}
                  onChange={(e) => field("scope")(e.target.value as SchemeScope)}
                />
              </Field>

              {form.scope === "model" ? (
                <Field help="The scheme applies to every account this model owns.">
                  <Label htmlFor="scheme-model" required>
                    Model
                  </Label>
                  <Select
                    id="scheme-model"
                    placeholder="Select a model…"
                    required
                    options={modelOptions}
                    value={form.model_id}
                    onChange={(e) => field("model_id")(e.target.value)}
                  />
                </Field>
              ) : null}

              {form.scope === "account" ? (
                <Field help="The scheme applies to this single platform account only.">
                  <Label htmlFor="scheme-account" required>
                    Platform account
                  </Label>
                  <Select
                    id="scheme-account"
                    placeholder="Select an account…"
                    required
                    options={accountOptions}
                    value={form.platform_account_id}
                    onChange={(e) => field("platform_account_id")(e.target.value)}
                  />
                </Field>
              ) : null}
            </>
          ) : scheme ? (
            <Field help="A scheme's scope cannot change — create a new scheme for a different scope.">
              <Label>Scope</Label>
              <div className="flex items-center gap-2">
                <Badge variant={SCOPE_META[scheme.scope].badge}>
                  {SCOPE_META[scheme.scope].label}
                </Badge>
                <span className="text-sm text-muted">{scheme.scopeLabel}</span>
              </div>
            </Field>
          ) : null}

          {/* ------------------------------------------------------- splits --- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <Label htmlFor="scheme-model-pct" required hint="0–100%">
                Model %
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
              <Label htmlFor="scheme-operator-pct" required hint="pool, 0–100%">
                Operator %
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
              <Label htmlFor="scheme-studio-pct" required hint="0–100%">
                Studio %
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
            <span>Must total exactly 100%. Operator % is the pool, split later by assignment weights.</span>
            <span className="font-semibold tabular-nums">{sum}%</span>
          </div>

          {/* ----------------------------------------------- effective dates --- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help="The scheme governs periods whose close date falls in this window.">
              <Label htmlFor="scheme-from" required>
                Effective from
              </Label>
              <Input
                id="scheme-from"
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => field("effective_from")(e.target.value)}
              />
            </Field>

            <Field help="Leave blank for open-ended. Set a date to close (supersede) this scheme.">
              <Label htmlFor="scheme-to">Effective to</Label>
              <Input
                id="scheme-to"
                type="date"
                value={form.effective_to}
                min={form.effective_from || undefined}
                onChange={(e) => field("effective_to")(e.target.value)}
              />
            </Field>
          </div>

          <Field help="Optional context — why this split, or the agreement it reflects.">
            <Label htmlFor="scheme-notes">Notes</Label>
            <Textarea
              id="scheme-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder="Anything the finance team should know"
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
