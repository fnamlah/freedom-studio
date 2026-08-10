"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

import { setOperatorStatus } from "./actions";
import { OPERATOR_STATUS_OPTIONS, type OperatorStatus } from "./status";

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
        success("Status updated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not change status", result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        Change status
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Change status"
        description="Lifecycle changes are recorded in the audit log."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={save} loading={isRunning} disabled={next === status}>
              Save
            </Button>
          </>
        }
      >
        <Field help="Terminated operators keep their assignment history — it can never be deleted.">
          <Label htmlFor="operator-status-select" required>
            Status
          </Label>
          <Select
            id="operator-status-select"
            options={OPERATOR_STATUS_OPTIONS}
            value={next}
            onChange={(e) => setNext(e.target.value as OperatorStatus)}
          />
        </Field>
      </Dialog>
    </>
  );
}
