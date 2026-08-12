"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { roleDescription, roleLabel, type Role } from "@/lib/auth/roles";
import { useDict, useLocale } from "@/lib/i18n/client";

import { inviteUser } from "./actions";

export type ModelOption = { id: string; stage_name: string };
export type OperatorOption = { id: string; display_name: string };

/** Super Admin is singular and DB-enforced — never an invitable role (docs/03 §2.2). */
const INVITABLE_ROLES: Role[] = ["manager", "model", "finance", "operator"];

export function InviteForm({
  models,
  operators,
}: {
  models: ModelOption[];
  operators: OperatorOption[];
}) {
  const router = useRouter();
  const locale = useLocale();
  const dict = useDict();
  const d = dict.adminAi.invitations;
  // Built per render rather than at module scope: the labels are locale-bound.
  const roleOptions: SelectOption[] = INVITABLE_ROLES.map((role) => ({
    value: role,
    label: roleLabel(locale, role),
  }));
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [modelId, setModelId] = useState("");
  const [operatorId, setOperatorId] = useState("");

  function reset() {
    setEmail("");
    setRole("");
    setModelId("");
    setOperatorId("");
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
    reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) {
      error(d.roleRequiredTitle, d.roleRequiredBody);
      return;
    }

    startTransition(async () => {
      const result = await inviteUser({
        email,
        role,
        modelId: role === "model" && modelId ? modelId : null,
        operatorId: role === "operator" && operatorId ? operatorId : null,
      });

      if (result.ok) {
        success(d.toastSent, result.message);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        error(d.toastFailed, result.error);
      }
    });
  }

  const modelOptions: SelectOption[] = models.map((m) => ({ value: m.id, label: m.stage_name }));
  const operatorOptions: SelectOption[] = operators.map((o) => ({
    value: o.id,
    label: o.display_name,
  }));

  return (
    <>
      <Button onClick={() => setOpen(true)}>{d.openCta}</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.dialogTitle}
        description={d.dialogDescription}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {dict.common.cancel}
            </Button>
            <Button type="submit" form="invite-form" loading={isRunning}>
              {d.submitCta}
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help={d.emailHelp}>
            <Label htmlFor="invite-email" required>
              {d.emailLabel}
            </Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={d.emailPlaceholder}
            />
          </Field>

          <Field help={role ? roleDescription(locale, role) : d.roleHelp}>
            <Label htmlFor="invite-role" required>
              {d.roleLabel}
            </Label>
            <Select
              id="invite-role"
              name="role"
              required
              placeholder={d.rolePlaceholder}
              options={roleOptions}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role | "");
                setModelId("");
                setOperatorId("");
              }}
            />
          </Field>

          {role === "model" ? (
            <Field help={d.preLinkModelHelp}>
              <Label htmlFor="invite-model">{d.preLinkModelLabel}</Label>
              <Select
                id="invite-model"
                name="modelId"
                placeholder={d.preLinkNone}
                options={modelOptions}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </Field>
          ) : null}

          {role === "operator" ? (
            <Field help={d.preLinkOperatorHelp}>
              <Label htmlFor="invite-operator">{d.preLinkOperatorLabel}</Label>
              <Select
                id="invite-operator"
                name="operatorId"
                placeholder={d.preLinkNone}
                options={operatorOptions}
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
              />
            </Field>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
