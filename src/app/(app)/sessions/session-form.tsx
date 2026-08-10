"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { duration } from "@/lib/format";

import { createSession, updateSession } from "./actions";

/** Model choices for the picker. */
export type ModelOption = { id: string; stage_name: string };

/** Platform-account choices, pre-labelled and scoped to their owning model. */
export type AccountOption = {
  id: string;
  model_id: string;
  label: string;
  platform_fee_percent: number | null;
  status: string;
};

/** The subset of a session the edit dialog rehydrates. */
export type EditableSession = {
  id: string;
  model_id: string;
  platform_account_id: string;
  started_at: string;
  ended_at: string | null;
  gross_earnings: number;
  currency: string;
  notes: string | null;
};

type FormState = {
  model_id: string;
  platform_account_id: string;
  started_at: string;
  ended_at: string;
  gross_earnings: string;
  currency: string;
  notes: string;
};

/** ISO timestamp → `YYYY-MM-DDThh:mm` in UTC, for a `datetime-local` input. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())}`;
}

function initialState(session?: EditableSession): FormState {
  return {
    model_id: session?.model_id ?? "",
    platform_account_id: session?.platform_account_id ?? "",
    started_at: toLocalInput(session?.started_at),
    ended_at: toLocalInput(session?.ended_at ?? null),
    gross_earnings:
      session?.gross_earnings !== undefined ? String(session.gross_earnings) : "0",
    currency: session?.currency ?? "USD",
    notes: session?.notes ?? "",
  };
}

/** Minutes between two `datetime-local` values, or null. Local preview only. */
function previewMinutes(started: string, ended: string): number | null {
  if (!started || !ended) return null;
  const s = new Date(`${started}Z`).getTime();
  const e = new Date(`${ended}Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return Math.round((e - s) / 60000);
}

/**
 * Create/edit dialog for a work session. Self-contained: renders its own trigger.
 *
 * The model picker only scopes which accounts are offered — the server derives the
 * authoritative `model_id` from the chosen account (docs/04 §4.6 denormalization),
 * so the two can never disagree.
 */
export function SessionForm({
  mode,
  models,
  accounts,
  session,
}: {
  mode: "create" | "edit";
  models: ModelOption[];
  accounts: AccountOption[];
  session?: EditableSession;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialState(session));

  const isCreate = mode === "create";
  const noAccounts = accounts.length === 0;

  const modelOptions: SelectOption[] = useMemo(
    () => models.map((m) => ({ value: m.id, label: m.stage_name })),
    [models],
  );

  const accountOptions: SelectOption[] = useMemo(() => {
    if (!form.model_id) return [];
    return accounts
      .filter((a) => a.model_id === form.model_id)
      .map((a) => ({ value: a.id, label: a.label }));
  }, [accounts, form.model_id]);

  const durationPreview = previewMinutes(form.started_at, form.ended_at);

  function openDialog() {
    setForm(initialState(session));
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function selectModel(next: string) {
    setForm((prev) => ({ ...prev, model_id: next, platform_account_id: "" }));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const payload = {
        platform_account_id: form.platform_account_id,
        started_at: form.started_at,
        ended_at: form.ended_at,
        gross_earnings: form.gross_earnings,
        currency: form.currency,
        notes: form.notes,
      };

      const result = isCreate
        ? await createSession(payload)
        : await updateSession({ id: session!.id, ...payload });

      if (result.ok) {
        success(isCreate ? "Session logged" : "Session updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(isCreate ? "Could not log session" : "Could not update session", result.error);
      }
    });
  }

  return (
    <>
      {isCreate ? (
        <Button onClick={openDialog}>Log session</Button>
      ) : (
        <Button variant="outline" size="sm" onClick={openDialog}>
          Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={isCreate ? "Log a work session" : "Edit session"}
        description="Sessions are the hours source of truth (docs/04 §4.6). Leave the end time blank to start an open session; duration is computed by the database."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="session-form" loading={isRunning} disabled={noAccounts}>
              {isCreate ? "Log session" : "Save changes"}
            </Button>
          </>
        }
      >
        {noAccounts ? (
          <p className="text-sm text-muted">
            No platform accounts exist yet. Add a model and a platform account first — sessions are
            always tied to an account.
          </p>
        ) : (
          <form id="session-form" onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help="Scopes which accounts you can pick below.">
                <Label htmlFor="session-model" required>
                  Model
                </Label>
                <Select
                  id="session-model"
                  required
                  placeholder="Select a model…"
                  options={modelOptions}
                  value={form.model_id}
                  onChange={(e) => selectModel(e.target.value)}
                />
              </Field>

              <Field
                help={
                  form.model_id && accountOptions.length === 0
                    ? "This model has no platform accounts yet."
                    : undefined
                }
              >
                <Label htmlFor="session-account" required>
                  Platform account
                </Label>
                <Select
                  id="session-account"
                  required
                  disabled={!form.model_id || accountOptions.length === 0}
                  placeholder={form.model_id ? "Select an account…" : "Choose a model first"}
                  options={accountOptions}
                  value={form.platform_account_id}
                  onChange={(e) => set("platform_account_id", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help="Interpreted as UTC, matching how times display across the app.">
                <Label htmlFor="session-start" required>
                  Started at
                </Label>
                <Input
                  id="session-start"
                  type="datetime-local"
                  required
                  value={form.started_at}
                  onChange={(e) => set("started_at", e.target.value)}
                />
              </Field>

              <Field
                help={
                  durationPreview !== null
                    ? `Duration: ${duration(durationPreview)}`
                    : "Blank = open session (still running)."
                }
              >
                <Label htmlFor="session-end">Ended at</Label>
                <Input
                  id="session-end"
                  type="datetime-local"
                  value={form.ended_at}
                  onChange={(e) => set("ended_at", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field help="Per-session earnings when known. The money source of truth is Earnings.">
                <Label htmlFor="session-gross" required hint="≥ 0">
                  Gross earnings
                </Label>
                <Input
                  id="session-gross"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={form.gross_earnings}
                  onChange={(e) => set("gross_earnings", e.target.value)}
                />
              </Field>

              <Field help="3-letter code, e.g. USD.">
                <Label htmlFor="session-currency" required>
                  Currency
                </Label>
                <Input
                  id="session-currency"
                  autoComplete="off"
                  maxLength={3}
                  required
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="uppercase"
                />
              </Field>
            </div>

            <Field help="Internal only — never shown in self-service views.">
              <Label htmlFor="session-notes">Notes</Label>
              <Textarea
                id="session-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Anything worth recording about this session"
              />
            </Field>
          </form>
        )}
      </Dialog>
    </>
  );
}
