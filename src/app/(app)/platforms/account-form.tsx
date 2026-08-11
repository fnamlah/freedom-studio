"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

import { createPlatformAccount, updatePlatformAccount } from "./actions";
import { ACCOUNT_STATUS_OPTIONS, type AccountStatus } from "./status";

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
        success(isCreate ? "Account added" : "Account updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(isCreate ? "Could not add account" : "Could not update account", result.error);
      }
    });
  }

  const modelOptions: SelectOption[] = models.map((m) => ({
    value: m.id,
    label: m.stage_name,
  }));
  const platformOptions: SelectOption[] = platforms.map((p) => ({
    value: p.id,
    label: p.is_active ? p.name : `${p.name} (inactive)`,
  }));

  const defaultLabel = isCreate ? "New account" : "Edit";

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
        title={isCreate ? "Add a platform account" : "Edit account"}
        description={
          isCreate
            ? "Link a model to one of the studio's platforms."
            : "Update this account's username and platform fee."
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="account-form" loading={isRunning}>
              {isCreate ? "Add account" : "Save changes"}
            </Button>
          </>
        }
      >
        <form id="account-form" onSubmit={submit} className="flex flex-col gap-4">
          {isCreate ? (
            <>
              {lockedModel ? (
                <Field>
                  <Label>Model</Label>
                  <Input value={lockedModel.stage_name} readOnly disabled />
                </Field>
              ) : (
                <Field>
                  <Label htmlFor="account-model" required>
                    Model
                  </Label>
                  <Select
                    id="account-model"
                    required
                    placeholder="Select a model…"
                    options={modelOptions}
                    value={form.model_id}
                    onChange={(e) => field("model_id")(e.target.value)}
                  />
                </Field>
              )}

              <Field help="Platforms with accounts can't be deleted (docs/04 §4.5).">
                <Label htmlFor="account-platform" required>
                  Platform
                </Label>
                <Select
                  id="account-platform"
                  required
                  placeholder="Select a platform…"
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
                Username
              </Label>
              <Input
                id="account-username"
                required
                autoComplete="off"
                value={form.username}
                onChange={(e) => field("username")(e.target.value)}
                placeholder="On-platform handle"
              />
            </Field>

            <Field help="The platform's revenue cut. Leave blank if unknown.">
              <Label htmlFor="account-fee" hint="0–100%">
                Platform fee %
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
                placeholder="e.g. 20"
              />
            </Field>
          </div>

          {isCreate ? (
            <Field help="Account lifecycle. Change it later from the accounts table.">
              <Label htmlFor="account-status" required>
                Status
              </Label>
              <Select
                id="account-status"
                options={ACCOUNT_STATUS_OPTIONS}
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
