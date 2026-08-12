"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { createOperator, updateOperator } from "./actions";
import { operatorStatusOptions, type OperatorStatus } from "./status";

/** The subset of columns the form reads/writes (sensitive `legal_name` included). */
export type EditableOperator = {
  id: string;
  display_name: string;
  legal_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  start_date: string | null;
  notes: string | null;
};

type FormState = {
  display_name: string;
  legal_name: string;
  email: string;
  phone: string;
  country: string;
  start_date: string;
  notes: string;
  status: OperatorStatus;
};

function initialState(operator?: EditableOperator): FormState {
  return {
    display_name: operator?.display_name ?? "",
    legal_name: operator?.legal_name ?? "",
    email: operator?.email ?? "",
    phone: operator?.phone ?? "",
    country: operator?.country ?? "",
    start_date: operator?.start_date ?? "",
    notes: operator?.notes ?? "",
    status: "active",
  };
}

/**
 * Create/edit dialog for an operator. Self-contained: renders its own trigger.
 *
 * - `mode="create"` collects an initial lifecycle status.
 * - `mode="edit"` omits status — lifecycle transitions run through the dedicated
 *   status control on the detail page (audited as `operator.status_change`),
 *   keeping profile edits and status changes separately audited.
 */
export function OperatorForm({
  mode,
  operator,
}: {
  mode: "create" | "edit";
  operator?: EditableOperator;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(operator));
  const d = useDict();

  const isCreate = mode === "create";

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openDialog() {
    setForm(initialState(operator));
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const result = isCreate
        ? await createOperator({
            display_name: form.display_name,
            legal_name: form.legal_name,
            email: form.email,
            phone: form.phone,
            country: form.country,
            start_date: form.start_date,
            notes: form.notes,
            status: form.status,
          })
        : await updateOperator({
            id: operator!.id,
            display_name: form.display_name,
            legal_name: form.legal_name,
            email: form.email,
            phone: form.phone,
            country: form.country,
            start_date: form.start_date,
            notes: form.notes,
          });

      if (result.ok) {
        success(
          isCreate ? d.studio.operators.toastCreated : d.studio.operators.toastUpdated,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate
            ? d.studio.operators.toastCreateFailed
            : d.studio.operators.toastUpdateFailed,
          result.error,
        );
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>{d.studio.operators.newOperator}</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          {d.common.edit}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? d.studio.operators.createTitle : d.studio.operators.editTitle}
        description={
          isCreate
            ? d.studio.operators.createDescription
            : d.studio.operators.editDescription
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="operator-form" loading={isRunning}>
              {isCreate
                ? d.studio.operators.submitCreate
                : d.studio.operators.submitEdit}
            </Button>
          </>
        }
      >
        <form id="operator-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="operator-display-name" required>
                {d.studio.operators.fieldDisplayName}
              </Label>
              <Input
                id="operator-display-name"
                required
                autoComplete="off"
                value={form.display_name}
                onChange={(e) => field("display_name")(e.target.value)}
                placeholder={d.studio.operators.placeholderDisplayName}
              />
            </Field>

            <Field help={d.studio.operators.helpLegalName}>
              <Label htmlFor="operator-legal-name" required>
                {d.studio.operators.fieldLegalName}
              </Label>
              <Input
                id="operator-legal-name"
                required
                autoComplete="off"
                value={form.legal_name}
                onChange={(e) => field("legal_name")(e.target.value)}
                placeholder={d.studio.operators.placeholderLegalName}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="operator-email">{d.studio.operators.fieldEmail}</Label>
              <Input
                id="operator-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => field("email")(e.target.value)}
                placeholder={d.studio.operators.placeholderEmail}
              />
            </Field>

            <Field>
              <Label htmlFor="operator-phone">{d.studio.operators.fieldPhone}</Label>
              <Input
                id="operator-phone"
                type="tel"
                autoComplete="off"
                value={form.phone}
                onChange={(e) => field("phone")(e.target.value)}
                placeholder={d.studio.operators.placeholderPhone}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help={d.studio.operators.helpCountry}>
              <Label htmlFor="operator-country">{d.studio.operators.fieldCountry}</Label>
              <Input
                id="operator-country"
                autoComplete="off"
                maxLength={2}
                value={form.country}
                onChange={(e) => field("country")(e.target.value.toUpperCase())}
                placeholder="US"
                className="uppercase"
              />
            </Field>

            <Field>
              <Label htmlFor="operator-start-date">
                {d.studio.operators.fieldStartDate}
              </Label>
              <Input
                id="operator-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => field("start_date")(e.target.value)}
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help={d.studio.operators.helpStatus}>
              <Label htmlFor="operator-status" required>
                {d.studio.operators.fieldStatus}
              </Label>
              <Select
                id="operator-status"
                options={operatorStatusOptions(d)}
                value={form.status}
                onChange={(e) => field("status")(e.target.value as OperatorStatus)}
              />
            </Field>
          ) : null}

          <Field help={d.studio.operators.helpNotes}>
            <Label htmlFor="operator-notes">{d.studio.operators.fieldNotes}</Label>
            <Textarea
              id="operator-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder={d.studio.operators.placeholderNotes}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
