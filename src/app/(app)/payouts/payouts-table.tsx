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
import type { Role } from "@/lib/auth/roles";
import { date, dateRange, money } from "@/lib/format";

import { approvePayout, cancelPayout, markPayoutPaid } from "./actions";

type PayoutStatus = "pending" | "approved" | "paid" | "cancelled";

export type PayoutRowView = {
  id: string;
  payee_name: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  studio_fee_amount: number;
  deductions: number;
  net_amount: number;
  currency: string;
  status: PayoutStatus;
  reference: string | null;
  paid_at: string | null;
  created_at: string;
};

const STATUS_META: Record<PayoutStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "primary" },
  paid: { label: "Paid", variant: "success" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

/**
 * Payouts table with role-appropriate actions (docs/09 §6):
 *   • Approve — Super Admin only, on a `pending` payout.
 *   • Mark paid — Finance / Super Admin, on an `approved` payout (posts settlement).
 *   • Cancel — before payment; `approved` rows are Super-Admin-only to cancel.
 * The buttons shown are the caller's true capabilities; the DB re-enforces every
 * transition, so a stale button that shouldn't act simply surfaces an error.
 */
export function PayoutsTable({ rows, role }: { rows: PayoutRowView[]; role: Role }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No payouts"
        description="No payouts match this view. Create one to start the maker-checker workflow, or clear the payee filter."
      />
    );
  }

  const isSA = role === "super_admin";
  const canSettle = role === "finance" || role === "super_admin";
  const canCancelPending = role === "super_admin" || role === "manager" || role === "finance";

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>Payee</TH>
          <TH>Period</TH>
          <TH align="right">Gross</TH>
          <TH align="right">Deductions</TH>
          <TH align="right">Net</TH>
          <TH>Status</TH>
          <TH align="right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const meta = STATUS_META[row.status];
          const showApprove = isSA && row.status === "pending";
          const showMarkPaid = canSettle && row.status === "approved";
          const showCancel =
            (row.status === "pending" && canCancelPending) ||
            (row.status === "approved" && isSA);

          const hasAction = showApprove || showMarkPaid || showCancel;

          return (
            <TR key={row.id}>
              <TD className="font-medium text-foreground">{row.payee_name}</TD>
              <TD className="whitespace-nowrap text-muted">
                {dateRange(row.period_start, row.period_end)}
              </TD>
              <TD numeric className="text-muted">
                {money(row.gross_amount, row.currency)}
              </TD>
              <TD numeric className="text-muted">
                {money(row.deductions, row.currency)}
              </TD>
              <TD numeric className="font-medium text-foreground">
                {money(row.net_amount, row.currency)}
              </TD>
              <TD>
                <Badge variant={meta.variant}>{meta.label}</Badge>
                {row.status === "paid" && row.paid_at ? (
                  <span className="ml-2 text-xs text-muted">{date(row.paid_at)}</span>
                ) : null}
              </TD>
              <TD align="right">
                {hasAction ? (
                  <div className="flex items-center justify-end gap-2">
                    {showApprove ? <ApproveButton id={row.id} payee={row.payee_name} net={money(row.net_amount, row.currency)} /> : null}
                    {showMarkPaid ? (
                      <MarkPaidButton id={row.id} payee={row.payee_name} net={money(row.net_amount, row.currency)} />
                    ) : null}
                    {showCancel ? <CancelButton id={row.id} payee={row.payee_name} /> : null}
                  </div>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

/* ---------------------------------------------------------------- approve --- */

function ApproveButton({ id, payee, net }: { id: string; payee: string; net: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await approvePayout({ id });
      if (result.ok) {
        success("Payout approved", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not approve", result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Approve
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Approve this payout?"
        description="Only a Super Admin can authorize a payout. This is the maker-checker gate before settlement (docs/09 §6)."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              Approve payout
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Approving <span className="font-medium text-foreground">{net}</span> to{" "}
          <span className="font-medium text-foreground">{payee}</span>. Finance will then record
          the external payment.
        </p>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------- mark paid --- */

function MarkPaidButton({ id, payee, net }: { id: string; payee: string; net: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("");

  function open_() {
    setReference("");
    setMethod("");
    setOpen(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await markPayoutPaid({ id, reference, payment_method: method });
      if (result.ok) {
        success("Payout settled", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not mark paid", result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={open_}>
        Mark paid
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Record settlement"
        description="Mark this approved payout paid after executing the payment externally. This posts the negative settlement entry to the ledger automatically (docs/09 §6)."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              Mark paid
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Settling <span className="font-medium text-foreground">{net}</span> to{" "}
            <span className="font-medium text-foreground">{payee}</span>.
          </p>
          <Field help="Optional — external transaction reference for the audit trail.">
            <Label htmlFor={`paid-ref-${id}`}>Reference</Label>
            <Input
              id={`paid-ref-${id}`}
              autoComplete="off"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TXN-48213"
            />
          </Field>
          <Field help="Optional — bank, wallet, etc.">
            <Label htmlFor={`paid-method-${id}`}>Payment method</Label>
            <Input
              id={`paid-method-${id}`}
              autoComplete="off"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. Wise transfer"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/* ----------------------------------------------------------------- cancel --- */

function CancelButton({ id, payee }: { id: string; payee: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelPayout({ id });
      if (result.ok) {
        success("Payout cancelled", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not cancel", result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Cancel this payout?"
        description="Cancelling is only possible before payment. A paid payout can never be cancelled — reverse it with a ledger adjustment instead (docs/09 §5.2)."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Keep payout
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              Cancel payout
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This cancels the payout to <span className="font-medium text-foreground">{payee}</span>.
        </p>
      </Dialog>
    </>
  );
}
