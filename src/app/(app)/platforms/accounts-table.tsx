"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH, percent } from "@/lib/format";

import { setPlatformAccountStatus } from "./actions";
import { AccountForm, type EditableAccount } from "./account-form";
import { ACCOUNT_STATUS_META, ACCOUNT_STATUS_OPTIONS, type AccountStatus } from "./status";

export type AccountRowView = {
  id: string;
  model_id: string;
  model_name: string;
  platform_name: string;
  username: string;
  platform_fee_percent: number | null;
  status: AccountStatus;
};

/** All platform accounts across every model, with inline status + edit. */
export function AccountsTable({ rows }: { rows: AccountRowView[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        bare
        title="No platform accounts yet"
        description="Use “New account” to link a model to a platform."
      />
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Model</TH>
          <TH>Platform</TH>
          <TH>Username</TH>
          <TH align="right">Platform fee</TH>
          <TH>Status</TH>
          <TH align="right">
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((account) => {
          const meta = ACCOUNT_STATUS_META[account.status];
          return (
            <TR key={account.id}>
              <TD className="font-medium text-foreground">{account.model_name}</TD>
              <TD className="text-muted">{account.platform_name}</TD>
              <TD className="text-muted">{account.username}</TD>
              <TD numeric>
                {account.platform_fee_percent == null
                  ? EM_DASH
                  : percent(account.platform_fee_percent)}
              </TD>
              <TD>
                <Badge variant={meta.variant} dot>
                  {meta.label}
                </Badge>
              </TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <StatusControl id={account.id} status={account.status} />
                  <AccountForm mode="edit" account={toEditable(account)} />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function toEditable(account: AccountRowView): EditableAccount {
  return {
    id: account.id,
    username: account.username,
    platform_fee_percent: account.platform_fee_percent,
  };
}

/**
 * Inline lifecycle-status control. Fires `setPlatformAccountStatus` (audited as
 * `account.status_change`), reverting on failure — mirrors the models module.
 */
function StatusControl({ id, status }: { id: string; status: AccountStatus }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [value, setValue] = useState<AccountStatus>(status);
  const [isRunning, startTransition] = useTransition();

  function change(next: AccountStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await setPlatformAccountStatus({ id, status: next });
      if (result.ok) {
        success("Status changed", result.message);
        router.refresh();
      } else {
        setValue(previous);
        error("Could not change status", result.error);
      }
    });
  }

  return (
    <Select
      aria-label="Change account status"
      className="h-9 w-32"
      options={ACCOUNT_STATUS_OPTIONS}
      value={value}
      disabled={isRunning}
      onChange={(e) => change(e.target.value as AccountStatus)}
    />
  );
}
