"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { isRole, roleLabel } from "@/lib/auth/roles";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { decideApproval } from "./actions";

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

export type ApprovalRowView = {
  id: string;
  action_type: string;
  state: ApprovalState;
  required_role: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  risk_reason: string | null;
  job_name: string | null;
  created_at: string;
  expires_at: string | null;
  decided_at: string | null;
  decider_name: string | null;
  last_error: string | null;
  attempt_count: number;
};

/** Colour only. `state` is a DB value; its label is read per render. */
const STATE_VARIANT: Record<ApprovalState, BadgeVariant> = {
  pending: "warning",
  approved: "primary",
  executed: "success",
  rejected: "muted",
  failed: "danger",
  expired: "muted",
};

/**
 * The approvals queue.
 *
 * Approve/Reject are shown only on `pending` rows. A stale button is harmless:
 * `decide_approval` refuses a second decision (22023) and refuses an actor whose
 * role does not satisfy the row (42501), so the worst case is an error message,
 * never a double execution.
 */
export function ApprovalsTable({ rows }: { rows: ApprovalRowView[] }) {
  const d = useDict().adminAi.hermes;

  if (rows.length === 0) {
    return <EmptyState title={d.emptyTitle} description={d.emptyDescription} />;
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>{d.colProposal}</TH>
          <TH>{d.colRequires}</TH>
          <TH>{d.colRaised}</TH>
          <TH>{d.colState}</TH>
          <TH className="text-right">{d.colDecision}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <ApprovalRow key={row.id} row={row} />
        ))}
      </TBody>
    </Table>
  );
}

function ApprovalRow({ row }: { row: ApprovalRowView }) {
  const router = useRouter();
  const dict = useDict();
  const d = dict.adminAi.hermes;
  const locale = useLocale();
  const fm = fmt(locale);
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");

  const stateLabel: Record<ApprovalState, string> = {
    pending: d.statePending,
    approved: d.stateApproved,
    executed: d.stateExecuted,
    rejected: d.stateRejected,
    failed: d.stateFailed,
    expired: d.stateExpired,
  };

  function decide(verdict: "approve" | "reject") {
    startTransition(async () => {
      const result = await decideApproval({ id: row.id, verdict, note });
      if (result.ok) {
        toast.success(result.message ?? d.okDecision);
        setConfirming(null);
        setNote("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <TR>
        <TD>
          <div className="font-medium text-foreground">{row.summary}</div>
          <div className="mt-0.5 text-xs text-muted">
            {row.action_type}
            {row.job_name ? d.raisedBy(row.job_name) : ""}
          </div>
          {row.details.length > 0 && (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {row.details.map((d) => (
                <div key={d.label} className="flex gap-1.5">
                  <dt className="text-muted">{d.label}:</dt>
                  <dd className="text-foreground">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {row.risk_reason && (
            <p className="mt-2 text-xs text-warning">{row.risk_reason}</p>
          )}
          {row.state === "failed" && row.last_error && (
            <p className="mt-2 text-xs text-danger">
              {row.last_error}
              {row.attempt_count > 0 ? d.afterAttempts(row.attempt_count) : ""}
            </p>
          )}
        </TD>
        {/* `required_role` is a `user_role` enum value; a value the app does not
            know is shown as-is rather than blank. */}
        <TD className="whitespace-nowrap text-sm">
          {isRole(row.required_role)
            ? roleLabel(locale, row.required_role)
            : row.required_role.replace("_", " ")}
        </TD>
        <TD className="whitespace-nowrap text-sm text-muted">{fm.dateTime(row.created_at)}</TD>
        <TD>
          <Badge variant={STATE_VARIANT[row.state]}>{stateLabel[row.state]}</Badge>
          {row.decided_at && row.decider_name && (
            <div className="mt-1 text-xs text-muted">
              {d.decidedBy(row.decider_name, fm.dateTime(row.decided_at))}
            </div>
          )}
        </TD>
        <TD className="text-right">
          {row.state === "pending" ? (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirming("reject")}
              >
                {d.reject}
              </Button>
              <Button size="sm" disabled={pending} onClick={() => setConfirming("approve")}>
                {d.approve}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </TD>
      </TR>

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === "approve" ? d.approveDialogTitle : d.rejectDialogTitle}
      >
        <p className="text-sm text-muted">{row.summary}</p>
        {confirming === "approve" && (
          <p className="mt-3 text-sm text-foreground">{d.approveDialogBody}</p>
        )}
        <Field className="mt-4">
          <Label htmlFor={`note-${row.id}`}>{d.noteLabel}</Label>
          <Input
            id={`note-${row.id}`}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={d.notePlaceholder}
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending}>
            {dict.common.cancel}
          </Button>
          <Button
            variant={confirming === "reject" ? "danger" : "primary"}
            disabled={pending}
            onClick={() => confirming && decide(confirming)}
          >
            {pending ? d.recording : confirming === "approve" ? d.approve : d.reject}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
