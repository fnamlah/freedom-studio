"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { setPlatformAccountStatus } from "./actions";
import { AccountForm, type EditableAccount } from "./account-form";
import { accountStatusMeta, accountStatusOptions, type AccountStatus } from "./status";

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
  const d = useDict();
  const fm = fmt(useLocale());

  if (rows.length === 0) {
    return (
      <EmptyState
        bare
        title={d.studio.platforms.accountsEmptyTitle}
        description={d.studio.platforms.accountsEmptyDescription}
      />
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>{d.studio.platforms.colModel}</TH>
          <TH>{d.studio.platforms.colPlatform}</TH>
          <TH>{d.studio.platforms.colUsername}</TH>
          <TH align="right">{d.studio.platforms.colPlatformFee}</TH>
          <TH>{d.studio.platforms.colStatus}</TH>
          <TH align="right">
            <span className="sr-only">{d.common.actions}</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((account) => {
          const meta = accountStatusMeta(d, account.status);
          return (
            <TR key={account.id}>
              <TD className="font-medium text-foreground">{account.model_name}</TD>
              <TD className="text-muted">{account.platform_name}</TD>
              <TD className="text-muted">{account.username}</TD>
              <TD numeric>
                {account.platform_fee_percent == null
                  ? EM_DASH
                  : fm.percent(account.platform_fee_percent)}
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
  const d = useDict();

  function change(next: AccountStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await setPlatformAccountStatus({ id, status: next });
      if (result.ok) {
        success(d.studio.platforms.toastAccountStatusChanged, result.message);
        router.refresh();
      } else {
        setValue(previous);
        error(d.studio.platforms.toastAccountStatusFailed, result.error);
      }
    });
  }

  return (
    <Select
      aria-label={d.studio.platforms.accountStatusAria}
      className="h-9 w-32"
      options={accountStatusOptions(d)}
      value={value}
      disabled={isRunning}
      onChange={(e) => change(e.target.value as AccountStatus)}
    />
  );
}
