"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { dateTime, duration, EM_DASH, money } from "@/lib/format";

import { deleteSession } from "./actions";
import { SessionForm, type AccountOption, type EditableSession, type ModelOption } from "./session-form";

export type SessionRow = {
  id: string;
  model_id: string;
  platform_account_id: string;
  model_name: string;
  account_label: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  gross_earnings: number;
  currency: string;
  notes: string | null;
};

/**
 * Sessions table. Each row edits (reusing `SessionForm`) or deletes; both actions
 * re-guard SA/MGR on the server. Rows are ordered newest-first by the page.
 */
export function SessionsTable({
  rows,
  models,
  accounts,
}: {
  rows: SessionRow[];
  models: ModelOption[];
  accounts: AccountOption[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sessions to show"
        description="No work sessions match this view. Log one, or clear the model filter to see the full list."
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Account</TH>
          <TH>Started</TH>
          <TH>Ended</TH>
          <TH align="right">Duration</TH>
          <TH align="right">Gross</TH>
          <TH align="right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const editable: EditableSession = {
            id: row.id,
            model_id: row.model_id,
            platform_account_id: row.platform_account_id,
            started_at: row.started_at,
            ended_at: row.ended_at,
            gross_earnings: row.gross_earnings,
            currency: row.currency,
            notes: row.notes,
          };

          return (
            <TR key={row.id}>
              <TD className="font-medium text-foreground">{row.model_name}</TD>
              <TD className="text-muted">{row.account_label}</TD>
              <TD className="text-muted">{dateTime(row.started_at)}</TD>
              <TD>
                {row.ended_at ? (
                  <span className="text-muted">{dateTime(row.ended_at)}</span>
                ) : (
                  <Badge variant="warning" dot>
                    Open
                  </Badge>
                )}
              </TD>
              <TD numeric>
                {row.duration_minutes === null ? EM_DASH : duration(row.duration_minutes)}
              </TD>
              <TD numeric>{money(row.gross_earnings, row.currency)}</TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <SessionForm
                    mode="edit"
                    models={models}
                    accounts={accounts}
                    session={editable}
                  />
                  <DeleteSessionButton
                    id={row.id}
                    label={`${row.model_name} · ${row.account_label}`}
                  />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

/** Delete with an explicit confirmation dialog — sessions are the hours record. */
function DeleteSessionButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteSession({ id });
      if (result.ok) {
        success("Session deleted", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not delete session", result.error);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Delete session?"
        description={`This permanently removes the session for ${label}. This can't be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              Delete session
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Deleting a session removes its recorded hours. Money statements in Earnings are unaffected.
        </p>
      </Dialog>
    </>
  );
}
