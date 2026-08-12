"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { setOperatorStatus } from "./actions";
import { operatorStatusOptions, type OperatorStatus } from "./status";

/**
 * Lifecycle-status control for a single operator, rendered in the detail header.
 * Kept separate from profile edits so the transition is audited on its own as
 * `operator.status_change` (docs/04 §4.16).
 */
export function OperatorStatusControl({
  operatorId,
  status,
}: {
  operatorId: string;
  status: OperatorStatus;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<OperatorStatus>(status);
  const [isRunning, startTransition] = useTransition();
  const d = useDict();

  function openDialog() {
    setNext(status);
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function save() {
    startTransition(async () => {
      const result = await setOperatorStatus({ id: operatorId, status: next });
      if (result.ok) {
        success(d.studio.operators.toastStatusChanged, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.studio.operators.toastStatusFailed, result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        {d.studio.operators.changeStatus}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.studio.operators.statusDialogTitle}
        description={d.studio.operators.statusDialogDescription}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button onClick={save} loading={isRunning} disabled={next === status}>
              {d.common.save}
            </Button>
          </>
        }
      >
        <Field help={d.studio.operators.helpStatusDialog}>
          <Label htmlFor="operator-status-select" required>
            {d.studio.operators.fieldStatus}
          </Label>
          <Select
            id="operator-status-select"
            options={operatorStatusOptions(d)}
            value={next}
            onChange={(e) => setNext(e.target.value as OperatorStatus)}
          />
        </Field>
      </Dialog>
    </>
  );
}
