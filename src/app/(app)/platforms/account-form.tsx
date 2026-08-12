"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { createPlatformAccount, updatePlatformAccount } from "./actions";
import { accountStatusOptions, type AccountStatus } from "./status";

export type ModelOption = { id: string; stage_name: string };
export type PlatformOption = { id: string; name: string; is_active: boolean };

/** The columns the edit form reads/writes. */
export type EditableAccount = {
  id: string;
  username: string;
  platform_fee_percent: number | null;
};

type FormState = {
  model_id: string;
  platform_id: string;
  username: string;
  platform_fee_percent: string;
  status: AccountStatus;
};

function initialState(account?: EditableAccount, lockedModel?: ModelOption): FormState {
  return {
    model_id: lockedModel?.id ?? "",
    platform_id: "",
    username: account?.username ?? "",
    platform_fee_percent:
      account?.platform_fee_percent != null ? String(account.platform_fee_percent) : "",
    status: "active",
  };
}

/**
 * Create/edit dialog for a model's platform account. Self-contained trigger.
 *
 * - `mode="create"` picks the model + platform, username, fee and initial status.
 *   Pass `lockedModel` to pin it to one model (e.g. embedded on a model detail
 *   page) — the model select is then hidden and pre-filled.
 * - `mode="edit"` changes username + fee only; the account's model/platform are
 *   identity and status is changed inline (audited as `account.status_change`).
 */
export function AccountForm({
  mode,
  account,
  models = [],
  platforms = [],
  lockedModel,
  triggerLabel,
  triggerVariant,
  triggerSize,
}: {
  mode: "create" | "edit";
  account?: EditableAccount;
  models?: ModelOption[];
  platforms?: PlatformOption[];
  lockedModel?: ModelOption;
  triggerLabel?: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(account, lockedModel));
  const d = useDict();

  const isCreate = mode === "create";

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }) as FormState);
  }

  function openDialog() {
    setForm(initialState(account, lockedModel));
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
        ? await createPlatformAccount({
            model_id: form.model_id,
            platform_id: form.platform_id,
            username: form.username,
            platform_fee_percent: form.platform_fee_percent,
            status: form.status,
          })
        : await updatePlatformAccount({
            id: account!.id,
            username: form.username,
            platform_fee_percent: form.platform_fee_percent,
          });

      if (result.ok) {
        success(
          isCreate
            ? d.studio.platforms.toastAccountCreated
            : d.studio.platforms.toastAccountUpdated,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate
            ? d.studio.platforms.toastAccountCreateFailed
            : d.studio.platforms.toastAccountUpdateFailed,
          result.error,
        );
      }
    });
  }

  const modelOptions: SelectOption[] = models.map((m) => ({
    value: m.id,
    label: m.stage_name,
  }));
  const platformOptions: SelectOption[] = platforms.map((p) => ({
    value: p.id,
    label: p.is_active ? p.name : d.studio.platforms.inactiveSuffix(p.name),
  }));

  const defaultLabel = isCreate ? d.studio.platforms.newAccount : d.common.edit;

  return (
    <>
      <Button
        onClick={openDialog}
        variant={triggerVariant ?? (isCreate ? "primary" : "outline")}
        size={triggerSize ?? (isCreate ? "md" : "sm")}
      >
        {triggerLabel ?? defaultLabel}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={
          isCreate
            ? d.studio.platforms.accountCreateTitle
            : d.studio.platforms.accountEditTitle
        }
        description={
          isCreate
            ? d.studio.platforms.accountCreateDescription
            : d.studio.platforms.accountEditDescription
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="account-form" loading={isRunning}>
              {isCreate
                ? d.studio.platforms.accountSubmitCreate
                : d.studio.platforms.accountSubmitEdit}
            </Button>
          </>
        }
      >
        <form id="account-form" onSubmit={submit} className="flex flex-col gap-4">
          {isCreate ? (
            <>
              {lockedModel ? (
                <Field>
                  <Label>{d.studio.platforms.fieldModel}</Label>
                  <Input value={lockedModel.stage_name} readOnly disabled />
                </Field>
              ) : (
                <Field>
                  <Label htmlFor="account-model" required>
                    {d.studio.platforms.fieldModel}
                  </Label>
                  <Select
                    id="account-model"
                    required
                    placeholder={d.studio.platforms.selectModel}
                    options={modelOptions}
                    value={form.model_id}
                    onChange={(e) => field("model_id")(e.target.value)}
                  />
                </Field>
              )}

              <Field help={d.studio.platforms.helpPlatform}>
                <Label htmlFor="account-platform" required>
                  {d.studio.platforms.fieldPlatform}
                </Label>
                <Select
                  id="account-platform"
                  required
                  placeholder={d.studio.platforms.selectPlatform}
                  options={platformOptions}
                  value={form.platform_id}
                  onChange={(e) => field("platform_id")(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="account-username" required>
                {d.studio.platforms.fieldUsername}
              </Label>
              <Input
                id="account-username"
                required
                autoComplete="off"
                value={form.username}
                onChange={(e) => field("username")(e.target.value)}
                placeholder={d.studio.platforms.placeholderUsername}
              />
            </Field>

            <Field help={d.studio.platforms.helpFee}>
              <Label htmlFor="account-fee" hint={d.studio.platforms.hintFee}>
                {d.studio.platforms.fieldFee}
              </Label>
              <Input
                id="account-fee"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={form.platform_fee_percent}
                onChange={(e) => field("platform_fee_percent")(e.target.value)}
                placeholder={d.studio.platforms.placeholderFee}
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help={d.studio.platforms.helpAccountStatus}>
              <Label htmlFor="account-status" required>
                {d.studio.platforms.fieldAccountStatus}
              </Label>
              <Select
                id="account-status"
                options={accountStatusOptions(d)}
                value={form.status}
                onChange={(e) => field("status")(e.target.value as AccountStatus)}
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
