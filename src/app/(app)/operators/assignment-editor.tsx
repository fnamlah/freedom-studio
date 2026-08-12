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
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { createAssignment, deleteAssignment, updateAssignment } from "./actions";
import { assignmentActivityMeta, type AssignmentActivity } from "./status";

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
  const d = useDict();
  const fm = fmt(useLocale());

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
        success(
          editing
            ? d.studio.operators.toastAssignmentUpdated
            : d.studio.operators.toastAssignmentCreated,
          result.message,
        );
        setEditorOpen(false);
        router.refresh();
      } else {
        error(
          editing
            ? d.studio.operators.toastAssignmentUpdateFailed
            : d.studio.operators.toastAssignmentCreateFailed,
          result.error,
        );
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deleteAssignment({ id: target.id, operator_id: operatorId });
      if (result.ok) {
        success(d.studio.operators.toastAssignmentRemoved, result.message);
        setDeleteTarget(null);
        router.refresh();
      } else {
        error(d.studio.operators.toastAssignmentRemoveFailed, result.error);
      }
    });
  }

  const noModels = models.length === 0;

  return (
    <Card>
      <CardHeader
        title={d.studio.operators.assignmentsTitle}
        description={d.studio.operators.assignmentsDescription}
        action={
          <Button size="sm" onClick={openCreate} disabled={noModels}>
            {d.studio.operators.newAssignment}
          </Button>
        }
      />

      {assignments.length === 0 ? (
        <EmptyState
          bare
          title={d.studio.operators.assignmentsEmptyTitle}
          description={
            noModels
              ? d.studio.operators.assignmentsEmptyNoModels
              : d.studio.operators.assignmentsEmptyDescription
          }
          action={
            noModels ? undefined : (
              <Button size="sm" onClick={openCreate}>
                {d.studio.operators.newAssignment}
              </Button>
            )
          }
        />
      ) : (
        <Table containerClassName="border-t border-border">
          <THead>
            <TR>
              <TH>{d.studio.operators.colModel}</TH>
              <TH align="right">{d.studio.operators.colPoolShare}</TH>
              <TH>{d.studio.operators.colPeriod}</TH>
              <TH>{d.studio.operators.colState}</TH>
              <TH align="right">{d.common.actions}</TH>
            </TR>
          </THead>
          <TBody>
            {assignments.map((row) => {
              const activityMeta = assignmentActivityMeta(d, row.activity);
              return (
                <TR key={row.id}>
                  <TD>
                    <div className="font-medium text-foreground">{row.model_name}</div>
                    {row.notes ? (
                      <div className="mt-0.5 max-w-xs truncate text-xs text-muted">{row.notes}</div>
                    ) : null}
                  </TD>
                  <TD numeric>{fm.percent(row.pool_share_percent)}</TD>
                  <TD className="text-muted">
                    {fm.dateRange(row.assigned_from, row.assigned_to)}
                    {row.assigned_to === null ? (
                      <span className="ml-1 text-xs">{d.studio.operators.openEnded}</span>
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
                        {d.common.edit}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => setDeleteTarget(row)}
                      >
                        {d.studio.operators.remove}
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
        title={
          editing
            ? d.studio.operators.assignmentEditTitle
            : d.studio.operators.assignmentCreateTitle
        }
        description={d.studio.operators.assignmentDialogDescription}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeEditor} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="assignment-form" loading={isRunning}>
              {editing
                ? d.studio.operators.assignmentSubmitEdit
                : d.studio.operators.assignmentSubmitCreate}
            </Button>
          </>
        }
      >
        <form id="assignment-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field help={d.studio.operators.helpModel}>
            <Label htmlFor="assignment-model" required>
              {d.studio.operators.fieldModel}
            </Label>
            <Select
              id="assignment-model"
              required
              placeholder={d.studio.operators.selectModel}
              options={modelOptions}
              value={form.model_id}
              onChange={(e) => field("model_id")(e.target.value)}
            />
          </Field>

          <Field help={d.studio.operators.helpPoolShare}>
            <Label
              htmlFor="assignment-share"
              required
              hint={d.studio.operators.hintPoolShare}
            >
              {d.studio.operators.fieldPoolShare}
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
                {d.studio.operators.fieldAssignedFrom}
              </Label>
              <Input
                id="assignment-from"
                type="date"
                required
                value={form.assigned_from}
                onChange={(e) => field("assigned_from")(e.target.value)}
              />
            </Field>

            <Field help={d.studio.operators.helpAssignedTo}>
              <Label htmlFor="assignment-to">{d.studio.operators.fieldAssignedTo}</Label>
              <Input
                id="assignment-to"
                type="date"
                value={form.assigned_to}
                onChange={(e) => field("assigned_to")(e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <Label htmlFor="assignment-notes">
              {d.studio.operators.fieldAssignmentNotes}
            </Label>
            <Textarea
              id="assignment-notes"
              value={form.notes}
              onChange={(e) => field("notes")(e.target.value)}
              placeholder={d.studio.operators.placeholderAssignmentNotes}
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
        title={d.studio.operators.removeTitle}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={isRunning}>
              {d.studio.operators.remove}
            </Button>
          </>
        }
      >
        <div className="text-sm text-foreground">
          <p>
            {deleteTarget
              ? d.studio.operators.removeQuestion(
                  deleteTarget.model_name,
                  fm.dateRange(deleteTarget.assigned_from, deleteTarget.assigned_to),
                )
              : null}
          </p>
          <p className="mt-2 text-muted">{d.studio.operators.removeBody}</p>
        </div>
      </Dialog>
    </Card>
  );
}
