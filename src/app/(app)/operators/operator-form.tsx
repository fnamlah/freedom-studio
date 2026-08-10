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

import { createOperator, updateOperator } from "./actions";
import { OPERATOR_STATUS_OPTIONS, type OperatorStatus } from "./status";

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
        success(isCreate ? "Operator added" : "Operator updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(isCreate ? "Could not add operator" : "Could not update operator", result.error);
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>New operator</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? "Add an operator" : "Edit operator"}
        description={
          isCreate
            ? "Create the business record. A self-service login can be linked later via an invite."
            : "Update this operator's profile. Lifecycle status is changed from the header."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="operator-form" loading={isRunning}>
              {isCreate ? "Add operator" : "Save changes"}
            </Button>
          </>
        }
      >
        <form id="operator-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="operator-display-name" required>
                Display name
              </Label>
              <Input
                id="operator-display-name"
                required
                autoComplete="off"
                value={form.display_name}
                onChange={(e) => field("display_name")(e.target.value)}
                placeholder="Working name"
              />
            </Field>

            <Field help="Sensitive — visible to Super Admin and Managers only.">
              <Label htmlFor="operator-legal-name" required>
                Legal name
              </Label>
              <Input
                id="operator-legal-name"
                required
                autoComplete="off"
                value={form.legal_name}
                onChange={(e) => field("legal_name")(e.target.value)}
                placeholder="Full legal name"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="operator-email">Email</Label>
              <Input
                id="operator-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => field("email")(e.target.value)}
                placeholder="operator@example.com"
              />
            </Field>

            <Field>
              <Label htmlFor="operator-phone">Phone</Label>
              <Input
                id="operator-phone"
                type="tel"
                autoComplete="off"
                value={form.phone}
                onChange={(e) => field("phone")(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help="ISO 3166-1 alpha-2, e.g. US, GB.">
              <Label htmlFor="operator-country">Country</Label>
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
              <Label htmlFor="operator-start-date">Start date</Label>
              <Input
                id="operator-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => field("start_date")(e.target.value)}
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help="Lifecycle state. Change it later from the operator's page.">
              <Label htmlFor="operator-status" required>
                Status
              </Label>
              <Select
                id="operator-status"
                options={OPERATOR_STATUS_OPTIONS}
                value={form.status}
                onChange={(e) => field("status")(e.target.value as OperatorStatus)}
              />
            </Field>
          ) : null}

          <Field help="Internal only — never shown in self-service views.">
            <Label htmlFor="operator-notes">Notes</Label>
            <Textarea
              id="operator-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder="Anything the team should know"
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
