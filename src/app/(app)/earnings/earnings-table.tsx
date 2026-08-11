"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { dateRange, money } from "@/lib/format";

import { deleteEarning } from "./actions";
import {
  EarningForm,
  type AccountOption,
  type EditableEarning,
  type ModelOption,
} from "./earning-form";

export type EarningRow = {
  id: string;
  model_id: string;
  platform_account_id: string;
  model_name: string;
  account_label: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  platform_fee_amount: number;
  net_amount: number;
  currency: string;
};

/**
 * Earnings table. Each row edits (reusing `EarningForm`) or deletes; both actions
 * re-guard SA/MGR on the server. Rows are ordered newest-period-first by the page.
 */
export function EarningsTable({
  rows,
  models,
  accounts,
}: {
  rows: EarningRow[];
  models: ModelOption[];
  accounts: AccountOption[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No statements to show"
        description="No earnings statements match this view. Record one, or clear the model filter to see the full list."
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Account</TH>
          <TH>Period</TH>
          <TH align="right">Gross</TH>
          <TH align="right">Platform fee</TH>
          <TH align="right">Net</TH>
          <TH align="right">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const editable: EditableEarning = {
            id: row.id,
            model_id: row.model_id,
            platform_account_id: row.platform_account_id,
            period_start: row.period_start,
            period_end: row.period_end,
            gross_amount: row.gross_amount,
            platform_fee_amount: row.platform_fee_amount,
            net_amount: row.net_amount,
            currency: row.currency,
          };

          return (
            <TR key={row.id}>
              <TD className="font-medium text-foreground">{row.model_name}</TD>
              <TD className="text-muted">{row.account_label}</TD>
              <TD className="text-muted">{dateRange(row.period_start, row.period_end)}</TD>
              <TD numeric>{money(row.gross_amount, row.currency)}</TD>
              <TD numeric className="text-muted">
                {money(row.platform_fee_amount, row.currency)}
              </TD>
              <TD numeric className="font-medium text-foreground">
                {money(row.net_amount, row.currency)}
              </TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <EarningForm
                    mode="edit"
                    models={models}
                    accounts={accounts}
                    earning={editable}
                  />
                  <DeleteEarningButton
                    id={row.id}
                    label={`${row.model_name} · ${dateRange(row.period_start, row.period_end)}`}
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

/** Delete with an explicit confirmation dialog — earnings are the money record. */
function DeleteEarningButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await deleteEarning({ id });
      if (result.ok) {
        success("Statement deleted", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not delete statement", result.error);
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
        title="Delete statement?"
        description={`This permanently removes the earnings statement for ${label}. This can't be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={isRunning}>
              Delete statement
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Earnings are the money source of truth. Deleting a statement removes it from the split
          inputs; already-posted ledger entries are unaffected.
        </p>
      </Dialog>
    </>
  );
}
