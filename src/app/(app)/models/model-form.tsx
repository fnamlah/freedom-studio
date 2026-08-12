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

import { createModel, updateModel } from "./actions";
import { modelStatusOptions, type ModelStatus } from "./status";

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
  const d = useDict();

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
        success(
          isCreate ? d.studio.models.toastCreated : d.studio.models.toastUpdated,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate
            ? d.studio.models.toastCreateFailed
            : d.studio.models.toastUpdateFailed,
          result.error,
        );
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>{d.studio.models.newModel}</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          {d.common.edit}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? d.studio.models.createTitle : d.studio.models.editTitle}
        description={
          isCreate
            ? d.studio.models.createDescription
            : d.studio.models.editDescription
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="model-form" loading={isRunning}>
              {isCreate ? d.studio.models.submitCreate : d.studio.models.submitEdit}
            </Button>
          </>
        }
      >
        <form id="model-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="model-stage-name" required>
                {d.studio.models.fieldStageName}
              </Label>
              <Input
                id="model-stage-name"
                required
                autoComplete="off"
                value={form.stage_name}
                onChange={(e) => field("stage_name")(e.target.value)}
                placeholder={d.studio.models.placeholderStageName}
              />
            </Field>

            <Field help={d.studio.models.helpLegalName}>
              <Label htmlFor="model-legal-name" required>
                {d.studio.models.fieldLegalName}
              </Label>
              <Input
                id="model-legal-name"
                required
                autoComplete="off"
                value={form.legal_name}
                onChange={(e) => field("legal_name")(e.target.value)}
                placeholder={d.studio.models.placeholderLegalName}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help={d.studio.models.helpDob}>
              <Label htmlFor="model-dob" required>
                {d.studio.models.fieldDob}
              </Label>
              <Input
                id="model-dob"
                type="date"
                required
                value={form.date_of_birth}
                onChange={(e) => field("date_of_birth")(e.target.value)}
              />
            </Field>

            <Field help={d.studio.models.helpCommission}>
              <Label htmlFor="model-commission" required hint={d.studio.models.hintCommission}>
                {d.studio.models.fieldCommission}
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
              <Label htmlFor="model-email">{d.studio.models.fieldEmail}</Label>
              <Input
                id="model-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => field("email")(e.target.value)}
                placeholder={d.studio.models.placeholderEmail}
              />
            </Field>

            <Field>
              <Label htmlFor="model-phone">{d.studio.models.fieldPhone}</Label>
              <Input
                id="model-phone"
                type="tel"
                autoComplete="off"
                value={form.phone}
                onChange={(e) => field("phone")(e.target.value)}
                placeholder={d.studio.models.placeholderPhone}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field help={d.studio.models.helpCountry}>
              <Label htmlFor="model-country">{d.studio.models.fieldCountry}</Label>
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
              <Label htmlFor="model-start-date">{d.studio.models.fieldStartDate}</Label>
              <Input
                id="model-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => field("start_date")(e.target.value)}
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help={d.studio.models.helpStatus}>
              <Label htmlFor="model-status" required>
                {d.studio.models.fieldStatus}
              </Label>
              <Select
                id="model-status"
                options={modelStatusOptions(d)}
                value={form.status}
                onChange={(e) => field("status")(e.target.value as ModelStatus)}
              />
            </Field>
          ) : null}

          <Field help={d.studio.models.helpNotes}>
            <Label htmlFor="model-notes">{d.studio.models.fieldNotes}</Label>
            <Textarea
              id="model-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder={d.studio.models.placeholderNotes}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
