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
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

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

/**
 * Badge colour per status. The LABEL comes from `d.money.payouts.status` — the
 * one payout-status dictionary shared with the dashboard's payout table.
 */
const STATUS_VARIANT: Record<PayoutStatus, BadgeVariant> = {
  pending: "warning",
  approved: "primary",
  paid: "success",
  cancelled: "muted",
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
  const d = useDict();
  const fm = fmt(useLocale());

  if (rows.length === 0) {
    return (
      <EmptyState title={d.money.payouts.emptyTitle} description={d.money.payouts.emptyDesc} />
    );
  }

  const isSA = role === "super_admin";
  const canSettle = role === "finance" || role === "super_admin";
  const canCancelPending = role === "super_admin" || role === "manager" || role === "finance";

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>{d.money.payouts.colPayee}</TH>
          <TH>{d.money.payouts.colPeriod}</TH>
          <TH align="right">{d.money.payouts.colGross}</TH>
          <TH align="right">{d.money.payouts.colDeductions}</TH>
          <TH align="right">{d.money.payouts.colNet}</TH>
          <TH>{d.common.status}</TH>
          <TH align="right">{d.common.actions}</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
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
                {fm.dateRange(row.period_start, row.period_end)}
              </TD>
              <TD numeric className="text-muted">
                {fm.money(row.gross_amount, row.currency)}
              </TD>
              <TD numeric className="text-muted">
                {fm.money(row.deductions, row.currency)}
              </TD>
              <TD numeric className="font-medium text-foreground">
                {fm.money(row.net_amount, row.currency)}
              </TD>
              <TD>
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {d.money.payouts.status[row.status]}
                </Badge>
                {row.status === "paid" && row.paid_at ? (
                  <span className="ml-2 text-xs text-muted">{fm.date(row.paid_at)}</span>
                ) : null}
              </TD>
              <TD align="right">
                {hasAction ? (
                  <div className="flex items-center justify-end gap-2">
                    {showApprove ? <ApproveButton id={row.id} payee={row.payee_name} net={fm.money(row.net_amount, row.currency)} /> : null}
                    {showMarkPaid ? (
                      <MarkPaidButton id={row.id} payee={row.payee_name} net={fm.money(row.net_amount, row.currency)} />
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
  const d = useDict();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await approvePayout({ id });
      if (result.ok) {
        success(d.money.payouts.approveToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.payouts.approveToastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {d.money.payouts.approveCta}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={d.money.payouts.approveTitle}
        description={d.money.payouts.approveDesc}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              {d.money.payouts.approveConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{d.money.payouts.approveBody(net, payee)}</p>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------- mark paid --- */

function MarkPaidButton({ id, payee, net }: { id: string; payee: string; net: string }) {
  const router = useRouter();
  const d = useDict();
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
        success(d.money.payouts.markPaidToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.payouts.markPaidToastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={open_}>
        {d.money.payouts.markPaidCta}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={d.money.payouts.markPaidTitle}
        description={d.money.payouts.markPaidDesc}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              {d.money.payouts.markPaidCta}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{d.money.payouts.markPaidBody(net, payee)}</p>
          <Field help={d.money.payouts.markPaidReferenceHelp}>
            <Label htmlFor={`paid-ref-${id}`}>{d.money.payouts.markPaidReference}</Label>
            <Input
              id={`paid-ref-${id}`}
              autoComplete="off"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={d.money.payouts.markPaidReferencePlaceholder}
            />
          </Field>
          <Field help={d.money.payouts.markPaidMethodHelp}>
            <Label htmlFor={`paid-method-${id}`}>{d.money.payouts.markPaidMethod}</Label>
            <Input
              id={`paid-method-${id}`}
              autoComplete="off"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder={d.money.payouts.markPaidMethodPlaceholder}
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
  const d = useDict();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelPayout({ id });
      if (result.ok) {
        success(d.money.payouts.cancelToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.payouts.cancelToastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {d.money.payouts.cancelCta}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={d.money.payouts.cancelTitle}
        description={d.money.payouts.cancelDesc}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.money.payouts.cancelKeep}
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              {d.money.payouts.cancelConfirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{d.money.payouts.cancelBody(payee)}</p>
      </Dialog>
    </>
  );
}
