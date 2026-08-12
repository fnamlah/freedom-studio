"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

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
  const d = useDict();
  const fm = fmt(useLocale());

  if (rows.length === 0) {
    return (
      <EmptyState
        title={d.studio.sessions.emptyTitle}
        description={d.studio.sessions.emptyDescription}
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>{d.studio.sessions.colModel}</TH>
          <TH>{d.studio.sessions.colAccount}</TH>
          <TH>{d.studio.sessions.colStarted}</TH>
          <TH>{d.studio.sessions.colEnded}</TH>
          <TH align="right">{d.studio.sessions.colDuration}</TH>
          <TH align="right">{d.studio.sessions.colGross}</TH>
          <TH align="right">{d.common.actions}</TH>
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
              <TD className="text-muted">{fm.dateTime(row.started_at)}</TD>
              <TD>
                {row.ended_at ? (
                  <span className="text-muted">{fm.dateTime(row.ended_at)}</span>
                ) : (
                  <Badge variant="warning" dot>
                    {d.studio.sessions.badgeOpen}
                  </Badge>
                )}
              </TD>
              <TD numeric>
                {row.duration_minutes === null ? EM_DASH : fm.duration(row.duration_minutes)}
              </TD>
              <TD numeric>{fm.money(row.gross_earnings, row.currency)}</TD>
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
  const d = useDict();

  function confirm() {
    startTransition(async () => {
      const result = await deleteSession({ id });
      if (result.ok) {
        success(d.studio.sessions.toastDeleted, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.studio.sessions.toastDeleteFailed, result.error);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {d.common.delete}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={d.studio.sessions.deleteTitle}
        description={d.studio.sessions.deleteDescription(label)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              {d.studio.sessions.deleteConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{d.studio.sessions.deleteBody}</p>
      </Dialog>
    </>
  );
}
