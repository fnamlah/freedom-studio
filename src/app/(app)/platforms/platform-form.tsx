"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { createPlatform, updatePlatform } from "./actions";
import { platformActiveOptions } from "./status";

/** The columns the platform form reads/writes. */
export type EditablePlatform = {
  id: string;
  name: string;
  website_url: string | null;
};

type FormState = {
  name: string;
  website_url: string;
  is_active: boolean;
};

function initialState(platform?: EditablePlatform): FormState {
  return {
    name: platform?.name ?? "",
    website_url: platform?.website_url ?? "",
    is_active: true,
  };
}

/**
 * Create/edit dialog for a platform. Self-contained: renders its own trigger.
 *
 * - `mode="create"` collects the initial `is_active` flag.
 * - `mode="edit"` omits it — activation is toggled from the table row (audited
 *   as `platform.status_change`), keeping profile edits and activation as
 *   separate, separately-audited actions (mirrors the models module).
 */
export function PlatformForm({
  mode,
  platform,
}: {
  mode: "create" | "edit";
  platform?: EditablePlatform;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(platform));
  const d = useDict();

  const isCreate = mode === "create";

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }) as FormState);
  }

  function openDialog() {
    setForm(initialState(platform));
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
        ? await createPlatform({
            name: form.name,
            website_url: form.website_url,
            is_active: form.is_active,
          })
        : await updatePlatform({
            id: platform!.id,
            name: form.name,
            website_url: form.website_url,
          });

      if (result.ok) {
        success(
          isCreate
            ? d.studio.platforms.toastPlatformCreated
            : d.studio.platforms.toastPlatformUpdated,
          result.message,
        );
        setOpen(false);
        router.refresh();
      } else {
        error(
          isCreate
            ? d.studio.platforms.toastPlatformCreateFailed
            : d.studio.platforms.toastPlatformUpdateFailed,
          result.error,
        );
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>{d.studio.platforms.newPlatform}</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          {d.common.edit}
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={
          isCreate
            ? d.studio.platforms.platformCreateTitle
            : d.studio.platforms.platformEditTitle
        }
        description={
          isCreate
            ? d.studio.platforms.platformCreateDescription
            : d.studio.platforms.platformEditDescription
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="platform-form" loading={isRunning}>
              {isCreate
                ? d.studio.platforms.platformSubmitCreate
                : d.studio.platforms.platformSubmitEdit}
            </Button>
          </>
        }
      >
        <form id="platform-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="platform-name" required>
              {d.studio.platforms.fieldName}
            </Label>
            <Input
              id="platform-name"
              required
              autoComplete="off"
              value={form.name}
              onChange={(e) => field("name")(e.target.value)}
              placeholder={d.studio.platforms.placeholderName}
            />
          </Field>

          <Field help={d.studio.platforms.helpWebsite}>
            <Label htmlFor="platform-url">{d.studio.platforms.fieldWebsite}</Label>
            <Input
              id="platform-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={form.website_url}
              onChange={(e) => field("website_url")(e.target.value)}
              placeholder={d.studio.platforms.placeholderWebsite}
            />
          </Field>

          {isCreate ? (
            <Field help={d.studio.platforms.helpPlatformStatus}>
              <Label htmlFor="platform-active" required>
                {d.studio.platforms.fieldPlatformStatus}
              </Label>
              <Select
                id="platform-active"
                options={platformActiveOptions(d)}
                value={form.is_active ? "active" : "inactive"}
                onChange={(e) => field("is_active")(e.target.value === "active")}
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
