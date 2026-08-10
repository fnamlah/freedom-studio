"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/auth/roles";

import { inviteUser } from "./actions";

export type ModelOption = { id: string; stage_name: string };
export type OperatorOption = { id: string; display_name: string };

/** Super Admin is singular and DB-enforced — never an invitable role (docs/03 §2.2). */
const INVITABLE_ROLES: Role[] = ["manager", "model", "finance", "operator"];

const ROLE_OPTIONS: SelectOption[] = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function InviteForm({
  models,
  operators,
}: {
  models: ModelOption[];
  operators: OperatorOption[];
}) {
  const router = useRouter();
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
      error("Role required", "Choose the role this person will have.");
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
        success("Invitation sent", result.message);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        error("Could not invite", result.error);
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
      <Button onClick={() => setOpen(true)}>Invite user</Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Invite a user"
        description="Sends a one-time invite email. The account is created only after they set a password and enroll TOTP."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={isRunning}>
              Send invite
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help="The invite link is sent here. One live invite per address.">
            <Label htmlFor="invite-email" required>
              Email
            </Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
            />
          </Field>

          <Field help={role ? ROLE_DESCRIPTIONS[role] : "Determines what the user can access."}>
            <Label htmlFor="invite-role" required>
              Role
            </Label>
            <Select
              id="invite-role"
              name="role"
              required
              placeholder="Select a role…"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role | "");
                setModelId("");
                setOperatorId("");
              }}
            />
          </Field>

          {role === "model" ? (
            <Field help="Links this login to an existing model record on signup.">
              <Label htmlFor="invite-model">Pre-link model</Label>
              <Select
                id="invite-model"
                name="modelId"
                placeholder="No pre-link"
                options={modelOptions}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </Field>
          ) : null}

          {role === "operator" ? (
            <Field help="Links this login to an existing operator record on signup.">
              <Label htmlFor="invite-operator">Pre-link operator</Label>
              <Select
                id="invite-operator"
                name="operatorId"
                placeholder="No pre-link"
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
