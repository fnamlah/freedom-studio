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

import { createModel, updateModel } from "./actions";
import { MODEL_STATUS_OPTIONS, type ModelStatus } from "./status";

/** The subset of columns the form reads/writes (sensitive fields included). */
export type EditableModel = {
  id: string;
  stage_name: string;
  legal_name: string;
  date_of_birth: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  start_date: string | null;
  commission_percent: number;
  notes: string | null;
};

type FormState = {
  stage_name: string;
  legal_name: string;
  date_of_birth: string;
  email: string;
  phone: string;
  country: string;
  start_date: string;
  commission_percent: string;
  notes: string;
  status: ModelStatus;
};

function initialState(model?: EditableModel): FormState {
  return {
    stage_name: model?.stage_name ?? "",
    legal_name: model?.legal_name ?? "",
    date_of_birth: model?.date_of_birth ?? "",
    email: model?.email ?? "",
    phone: model?.phone ?? "",
    country: model?.country ?? "",
    start_date: model?.start_date ?? "",
    commission_percent:
      model?.commission_percent !== undefined ? String(model.commission_percent) : "0",
    notes: model?.notes ?? "",
    status: "active",
  };
}

/**
 * Create/edit dialog for a model. Self-contained: renders its own trigger button.
 *
 * - `mode="create"` collects an initial lifecycle status.
 * - `mode="edit"` omits status — lifecycle transitions run through the dedicated
 *   status control (audited as `model.status_change`), keeping profile edits and
 *   status changes as separate, separately-audited actions.
 */
export function ModelForm({
  mode,
  model,
}: {
  mode: "create" | "edit";
  model?: EditableModel;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(model));

  const isCreate = mode === "create";

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }) as FormState);
  }

  function openDialog() {
    setForm(initialState(model));
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
        ? await createModel({
            stage_name: form.stage_name,
            legal_name: form.legal_name,
            date_of_birth: form.date_of_birth,
            email: form.email,
            phone: form.phone,
            country: form.country,
            start_date: form.start_date,
            commission_percent: form.commission_percent,
            notes: form.notes,
            status: form.status,
          })
        : await updateModel({
            id: model!.id,
            stage_name: form.stage_name,
            legal_name: form.legal_name,
            date_of_birth: form.date_of_birth,
            email: form.email,
            phone: form.phone,
            country: form.country,
            start_date: form.start_date,
            commission_percent: form.commission_percent,
            notes: form.notes,
          });

      if (result.ok) {
        success(isCreate ? "Model added" : "Model updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(isCreate ? "Could not add model" : "Could not update model", result.error);
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>New model</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? "Add a model" : "Edit model"}
        description={
          isCreate
            ? "Create the business record. A self-service login can be linked later via an invite."
            : "Update this model's profile. Lifecycle status is changed from the header."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="model-form" loading={isRunning}>
              {isCreate ? "Add model" : "Save changes"}
            </Button>
          </>
        }
      >
        <form id="model-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="model-stage-name" required>
                Stage name
              </Label>
              <Input
                id="model-stage-name"
                required
                autoComplete="off"
                value={form.stage_name}
                onChange={(e) => field("stage_name")(e.target.value)}
                placeholder="Public working name"
              />
            </Field>

            <Field help="Sensitive — visible to Super Admin and Managers only.">
              <Label htmlFor="model-legal-name" required>
                Legal name
              </Label>
              <Input
                id="model-legal-name"
                required
                autoComplete="off"
                value={form.legal_name}
                onChange={(e) => field("legal_name")(e.target.value)}
                placeholder="Full legal name"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help="Must be 18 or older — enforced by the database.">
              <Label htmlFor="model-dob" required>
                Date of birth
              </Label>
              <Input
                id="model-dob"
                type="date"
                required
                value={form.date_of_birth}
                onChange={(e) => field("date_of_birth")(e.target.value)}
              />
            </Field>

            <Field help="Legacy studio-cut default, superseded by commission schemes.">
              <Label htmlFor="model-commission" required hint="0–100%">
                Commission %
              </Label>
              <Input
                id="model-commission"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                required
                value={form.commission_percent}
                onChange={(e) => field("commission_percent")(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="model-email">Email</Label>
              <Input
                id="model-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => field("email")(e.target.value)}
                placeholder="model@example.com"
              />
            </Field>

            <Field>
              <Label htmlFor="model-phone">Phone</Label>
              <Input
                id="model-phone"
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
              <Label htmlFor="model-country">Country</Label>
              <Input
                id="model-country"
                autoComplete="off"
                maxLength={2}
                value={form.country}
                onChange={(e) => field("country")(e.target.value.toUpperCase())}
                placeholder="US"
                className="uppercase"
              />
            </Field>

            <Field>
              <Label htmlFor="model-start-date">Start date</Label>
              <Input
                id="model-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => field("start_date")(e.target.value)}
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help="Lifecycle state. Change it later from the model's page.">
              <Label htmlFor="model-status" required>
                Status
              </Label>
              <Select
                id="model-status"
                options={MODEL_STATUS_OPTIONS}
                value={form.status}
                onChange={(e) => field("status")(e.target.value as ModelStatus)}
              />
            </Field>
          ) : null}

          <Field help="Internal only — never shown in self-service views.">
            <Label htmlFor="model-notes">Notes</Label>
            <Textarea
              id="model-notes"
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
