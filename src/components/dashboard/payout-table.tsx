import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Enums } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

type PayoutStatus = Enums<"payout_status">;

const STATUS_VARIANT: Record<PayoutStatus, BadgeVariant> = {
  pending: "warning",
  approved: "primary",
  paid: "success",
  cancelled: "muted",
};

export type PayoutTableRow = {
  payout_id: string | null;
  payee_name: string | null;
  net_amount: number | null;
  currency: string | null;
  status: PayoutStatus | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
};

/**
 * Recent payouts, RLS-scoped by the caller's session (docs/07 §4 "payout history
 * … + table"). `showPayee` is on for studio/finance views and off for a single
 * payee's own dashboard.
 *
 * Status labels come from `d.money.payouts.status` — the ONE payout-status
 * dictionary. This file used to carry its own `STATUS_LABEL` map that duplicated
 * the dashboard loader's; two copies of four words is two chances to translate
 * them differently.
 */
export async function PayoutTable({
  rows,
  showPayee,
  limit = 8,
}: {
  rows: readonly PayoutTableRow[];
  showPayee: boolean;
  limit?: number;
}) {
  const d = await getDict();
  const fm = fmt(await getLocale());

  const sorted = [...rows]
    .sort((a, b) => (b.paid_at ?? b.period_end ?? "").localeCompare(a.paid_at ?? a.period_end ?? ""))
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <EmptyState
        bare
        title={d.money.payouts.dashEmptyTitle}
        description={d.money.payouts.dashEmptyDesc}
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          {showPayee ? <TH>{d.money.payouts.colPayee}</TH> : null}
          <TH>{d.money.payouts.colPeriod}</TH>
          <TH>{d.common.status}</TH>
          <TH align="right">{d.money.payouts.colNet}</TH>
        </TR>
      </THead>
      <TBody>
        {sorted.map((row, i) => (
          <TR key={row.payout_id ?? `payout-${i}`}>
            {showPayee ? (
              <TD className="font-medium text-foreground">{row.payee_name ?? "—"}</TD>
            ) : null}
            <TD className="whitespace-nowrap text-muted">
              {row.period_start ? fm.date(row.period_start) : "—"}
              {row.period_end ? ` – ${fm.date(row.period_end)}` : ""}
            </TD>
            <TD>
              {row.status ? (
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {d.money.payouts.status[row.status]}
                </Badge>
              ) : (
                <Badge variant="neutral">—</Badge>
              )}
            </TD>
            <TD numeric className="font-medium text-foreground">
              {fm.money(row.net_amount, row.currency ?? "USD")}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
