import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Enums } from "@/lib/database.types";
import { date, money } from "@/lib/format";

type PayoutStatus = Enums<"payout_status">;

const STATUS_VARIANT: Record<PayoutStatus, BadgeVariant> = {
  pending: "warning",
  approved: "primary",
  paid: "success",
  cancelled: "muted",
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  cancelled: "Cancelled",
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
 */
export function PayoutTable({
  rows,
  showPayee,
  limit = 8,
}: {
  rows: readonly PayoutTableRow[];
  showPayee: boolean;
  limit?: number;
}) {
  const sorted = [...rows]
    .sort((a, b) => (b.paid_at ?? b.period_end ?? "").localeCompare(a.paid_at ?? a.period_end ?? ""))
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <EmptyState
        bare
        title="No payouts yet"
        description="Payouts appear here once they are created."
      />
    );
  }

  return (
    <Table containerClassName="rounded-lg border border-border">
      <THead>
        <TR>
          {showPayee ? <TH>Payee</TH> : null}
          <TH>Period</TH>
          <TH>Status</TH>
          <TH align="right">Net</TH>
        </TR>
      </THead>
      <TBody>
        {sorted.map((row, i) => (
          <TR key={row.payout_id ?? `payout-${i}`}>
            {showPayee ? (
              <TD className="font-medium text-foreground">{row.payee_name ?? "—"}</TD>
            ) : null}
            <TD className="whitespace-nowrap text-muted">
              {row.period_start ? date(row.period_start) : "—"}
              {row.period_end ? ` – ${date(row.period_end)}` : ""}
            </TD>
            <TD>
              {row.status ? (
                <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              ) : (
                <Badge variant="neutral">—</Badge>
              )}
            </TD>
            <TD numeric className="font-medium text-foreground">
              {money(row.net_amount, row.currency ?? "USD")}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
