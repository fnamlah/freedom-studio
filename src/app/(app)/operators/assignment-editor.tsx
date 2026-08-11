"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { dateRange, EM_DASH, percent } from "@/lib/format";

import { createAssignment, deleteAssignment, updateAssignment } from "./actions";
import { ASSIGNMENT_ACTIVITY_META, type AssignmentActivity } from "./status";

export type AssignmentRow = {
  id: string;
  model_id: string;
  model_name: string;
  pool_share_percent: number;
  assigned_from: string;
  assigned_to: string | null;
  notes: string | null;
  activity: AssignmentActivity;
};

export type ModelOption = { id: string; stage_name: string };

type FormState = {
  model_id: string;
  pool_share_percent: string;
  assigned_from: string;
  assigned_to: string;
  notes: string;
};

function initialForm(row?: AssignmentRow): FormState {
  return {
    model_id: row?.model_id ?? "",
    pool_share_percent: row ? String(row.pool_share_percent) : "100",
    assigned_from: row?.assigned_from ?? "",
    assigned_to: row?.assigned_to ?? "",
    notes: row?.notes ?? "",
  };
}

/**
 * Assignment editor for one operator: which models they serve, over which date
 * range, and what fraction of each model's operator pool they receive
 * (docs/04 §4.8, docs/09 §4.3).
 *
 * The two cross-row rules — per-model pool ≤ 100% and no overlapping windows —
 * are enforced by the database (trigger + exclusion constraint). The server
 * action translates their errors into the friendly toasts surfaced here; the DB
 * is always the authority.
 */
export function AssignmentEditor({
  operatorId,
  assignments,
  models,
}: {
  operatorId: string;
  assignments: AssignmentRow[];
  models: ModelOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm());
  const [deleteTarget, setDeleteTarget] = useState<AssignmentRow | null>(null);
  const [isRunning, startTransition] = useTransition();

  const modelOptions: SelectOption[] = models.map((m) => ({ value: m.id, label: m.stage_name }));

  function field<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(initialForm());
    setEditorOpen(true);
  }

  function openEdit(row: AssignmentRow) {
    setEditing(row);
    setForm(initialForm(row));
    setEditorOpen(true);
  }

  function closeEditor() {
    if (isRunning) return;
    setEditorOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const payload = {
        operator_id: operatorId,
        model_id: form.model_id,
        pool_share_percent: form.pool_share_percent,
        assigned_from: form.assigned_from,
        assigned_to: form.assigned_to,
        notes: form.notes,
      };

      const result = editing
        ? await updateAssignment({ ...payload, id: editing.id })
        : await createAssignment(payload);

      if (result.ok) {
        success(editing ? "Assignment updated" : "Assignment created", result.message);
        setEditorOpen(false);
        router.refresh();
      } else {
        error(editing ? "Could not update assignment" : "Could not create assignment", result.error);
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deleteAssignment({ id: target.id, operator_id: operatorId });
      if (result.ok) {
        success("Assignment removed", result.message);
        setDeleteTarget(null);
        router.refresh();
      } else {
        error("Could not remove assignment", result.error);
      }
    });
  }

  const noModels = models.length === 0;

  return (
    <Card>
      <CardHeader
        title="Assignments"
        description="Models this operator serves, their pool share, and the active period."
        action={
          <Button size="sm" onClick={openCreate} disabled={noModels}>
            New assignment
          </Button>
        }
      />

      {assignments.length === 0 ? (
        <EmptyState
          bare
          title="No assignments yet"
          description={
            noModels
              ? "Create a model first, then assign this operator to it."
              : "Assign this operator to a model to start crediting them a share of its operator pool."
          }
          action={
            noModels ? undefined : (
              <Button size="sm" onClick={openCreate}>
                New assignment
              </Button>
            )
          }
        />
      ) : (
        <Table containerClassName="border-t border-border">
          <THead>
            <TR>
              <TH>Model</TH>
              <TH align="right">Pool share</TH>
              <TH>Period</TH>
              <TH>State</TH>
              <TH align="right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {assignments.map((row) => {
              const activityMeta = ASSIGNMENT_ACTIVITY_META[row.activity];
              return (
                <TR key={row.id}>
                  <TD>
                    <div className="font-medium text-foreground">{row.model_name}</div>
                    {row.notes ? (
                      <div className="mt-0.5 max-w-xs truncate text-xs text-muted">{row.notes}</div>
                    ) : null}
                  </TD>
                  <TD numeric>{percent(row.pool_share_percent)}</TD>
                  <TD className="text-muted">
                    {dateRange(row.assigned_from, row.assigned_to)}
                    {row.assigned_to === null ? (
                      <span className="ml-1 text-xs">(open-ended)</span>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge variant={activityMeta.variant} dot>
                      {activityMeta.label}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => setDeleteTarget(row)}
                      >
                        Remove
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={editorOpen}
        onClose={closeEditor}
        dismissible={!isRunning}
        title={editing ? "Edit assignment" : "New assignment"}
        description="The operator pool for a model can never exceed 100%, and windows for the same model can't overlap — both are enforced by the database."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeEditor} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="submit" form="assignment-form" loading={isRunning}>
              {editing ? "Save changes" : "Create assignment"}
            </Button>
          </>
        }
      >
        <form id="assignment-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help="The model this operator serves.">
            <Label htmlFor="assignment-model" required>
              Model
            </Label>
            <Select
              id="assignment-model"
              required
              placeholder="Select a model…"
              options={modelOptions}
              value={form.model_id}
              onChange={(e) => field("model_id")(e.target.value)}
            />
          </Field>

          <Field help="This operator's slice of the model's operator pool. All operators on one model must sum to ≤ 100%.">
            <Label htmlFor="assignment-share" required hint="0–100%">
              Pool share %
            </Label>
            <Input
              id="assignment-share"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              required
              value={form.pool_share_percent}
              onChange={(e) => field("pool_share_percent")(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="assignment-from" required>
                Assigned from
              </Label>
              <Input
                id="assignment-from"
                type="date"
                required
                value={form.assigned_from}
                onChange={(e) => field("assigned_from")(e.target.value)}
              />
            </Field>

            <Field help="Leave blank for an open-ended assignment.">
              <Label htmlFor="assignment-to">Assigned to</Label>
              <Input
                id="assignment-to"
                type="date"
                value={form.assigned_to}
                onChange={(e) => field("assigned_to")(e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <Label htmlFor="assignment-notes">Notes</Label>
            <Textarea
              id="assignment-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder="Optional context for this assignment"
            />
          </Field>
        </form>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isRunning) setDeleteTarget(null);
        }}
        dismissible={!isRunning}
        title="Remove assignment"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={isRunning}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={isRunning}>
              Remove
            </Button>
          </>
        }
      >
        <div className="text-sm text-foreground">
          <p>
            Remove this operator&rsquo;s assignment to{" "}
            <strong className="text-foreground">{deleteTarget?.model_name}</strong>
            {deleteTarget ? ` (${dateRange(deleteTarget.assigned_from, deleteTarget.assigned_to)})` : ""}?
          </p>
          <p className="mt-2 text-muted">
            Ledger entries already posted from past periods are unaffected — they are append-only.
            This change is recorded in the audit log.
          </p>
        </div>
      </Dialog>
    </Card>
  );
}
