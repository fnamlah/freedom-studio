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
import { dateTime } from "@/lib/format";

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

const STATE_META: Record<ApprovalState, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Awaiting you", variant: "warning" },
  approved: { label: "Approved — executing", variant: "primary" },
  executed: { label: "Done", variant: "success" },
  rejected: { label: "Rejected", variant: "muted" },
  failed: { label: "Failed", variant: "danger" },
  expired: { label: "Expired", variant: "muted" },
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
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing awaiting a decision"
        description="Hermes proposes actions here when it finds work that needs your authorisation — an unclosed period, a payee with an outstanding balance. Proposals it can't execute alone will always wait for you."
      />
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Proposal</TH>
          <TH>Requires</TH>
          <TH>Raised</TH>
          <TH>State</TH>
          <TH className="text-right">Decision</TH>
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
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");

  const meta = STATE_META[row.state];

  function decide(verdict: "approve" | "reject") {
    startTransition(async () => {
      const result = await decideApproval({ id: row.id, verdict, note });
      if (result.ok) {
        toast.success(result.message ?? "Decision recorded.");
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
            {row.job_name ? ` · raised by ${row.job_name}` : ""}
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
              {row.attempt_count > 0 ? ` (after ${row.attempt_count} attempts)` : ""}
            </p>
          )}
        </TD>
        <TD className="whitespace-nowrap text-sm">{row.required_role.replace("_", " ")}</TD>
        <TD className="whitespace-nowrap text-sm text-muted">{dateTime(row.created_at)}</TD>
        <TD>
          <Badge variant={meta.variant}>{meta.label}</Badge>
          {row.decided_at && row.decider_name && (
            <div className="mt-1 text-xs text-muted">
              by {row.decider_name}, {dateTime(row.decided_at)}
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
                Reject
              </Button>
              <Button size="sm" disabled={pending} onClick={() => setConfirming("approve")}>
                Approve
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
        title={confirming === "approve" ? "Approve this proposal?" : "Reject this proposal?"}
      >
        <p className="text-sm text-muted">{row.summary}</p>
        {confirming === "approve" && (
          <p className="mt-3 text-sm text-foreground">
            This will be carried out under your name, not the agent&apos;s. Hermes executes it
            within a few seconds.
          </p>
        )}
        <Field className="mt-4">
          <Label htmlFor={`note-${row.id}`}>Note (optional)</Label>
          <Input
            id={`note-${row.id}`}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Recorded on the decision"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={confirming === "reject" ? "danger" : "primary"}
            disabled={pending}
            onClick={() => confirming && decide(confirming)}
          >
            {pending ? "Recording…" : confirming === "approve" ? "Approve" : "Reject"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
