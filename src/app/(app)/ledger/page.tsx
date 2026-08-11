import type { Metadata } from "next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import type { Enums } from "@/lib/database.types";
import { date, money } from "@/lib/format";

import { ClosePeriodForm } from "./close-period-form";
import { PayeeFilter, type PayeeOption } from "./payee-filter";
import { PostEntryForm, type PayeePickOption } from "./post-entry-form";

export const metadata: Metadata = { title: "Ledger" };

type LedgerEntryType = Enums<"ledger_entry_type">;

type EntryRow = {
  id: number;
  payee_type: "model" | "operator";
  payee_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  earning_id: string | null;
  payout_id: string | null;
  commission_scheme_id: string | null;
  description: string | null;
  created_at: string;
};

const ENTRY_META: Record<LedgerEntryType, { label: string; variant: BadgeVariant }> = {
  earning_share: { label: "Earning share", variant: "success" },
  adjustment: { label: "Adjustment", variant: "primary" },
  deduction: { label: "Deduction", variant: "warning" },
  payout_settlement: { label: "Settlement", variant: "muted" },
};

/**
 * Ledger — the append-only, double-entry-lite journal (docs/09 §5). Readable by
 * every role, RLS-scoped: SA/MGR/FIN see all payees; models and operators see only
 * their own entries (docs/03/04). Posting (adjustment/deduction) and closing a
 * period (share generation) are Super-Admin/Finance only and re-guarded in
 * `./actions.ts` — so the page shows those controls to SA/FIN alone.
 *
 * A payee's balance is simply `SUM(amount)` over their rows (docs/09 §5), surfaced
 * here from `v_payee_balances`. The `?payee=` filter narrows the query server-side.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ payee?: string }>;
}) {
  const { supabase, role } = await requireRole(
    "super_admin",
    "manager",
    "finance",
    "model",
    "operator",
  );
  const { payee } = await searchParams;

  const canWrite = role === "super_admin" || role === "finance";

  const [modelDir, operatorDir, balances] = await Promise.all([
    supabase.from("v_model_directory").select("id, stage_name"),
    supabase.from("v_operator_directory").select("id, display_name"),
    supabase.from("v_payee_balances").select("payee_type, payee_id, display_name, currency, balance"),
  ]);

  const models = modelDir.data ?? [];
  const operators = operatorDir.data ?? [];
  const balanceRows = balances.data ?? [];

  /* ------------------------------------------------------------- payee list --- */

  const pickOptions: PayeePickOption[] = [
    ...models
      .filter((m): m is { id: string; stage_name: string } => !!m.id)
      .map((m) => ({
        payee_type: "model" as const,
        payee_id: m.id,
        label: `${m.stage_name ?? "Model"} · model`,
      })),
    ...operators
      .filter((o): o is { id: string; display_name: string } => !!o.id)
      .map((o) => ({
        payee_type: "operator" as const,
        payee_id: o.id,
        label: `${o.display_name ?? "Operator"} · operator`,
      })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const payeeName = new Map<string, string>();
  for (const p of pickOptions) payeeName.set(`${p.payee_type}:${p.payee_id}`, p.label);
  for (const b of balanceRows) {
    if (b.payee_type && b.payee_id && b.display_name) {
      const key = `${b.payee_type}:${b.payee_id}`;
      if (!payeeName.has(key)) payeeName.set(key, `${b.display_name} · ${b.payee_type}`);
    }
  }

  const filterOptions: PayeeOption[] = pickOptions.map((p) => ({
    value: `${p.payee_type}:${p.payee_id}`,
    label: p.label,
  }));

  /* ------------------------------------------------------------ active payee --- */

  const validValues = new Set(filterOptions.map((o) => o.value));
  const active = payee && validValues.has(payee) ? payee : null;
  const [activeType, activeId] = active ? active.split(":") : [null, null];

  /* ---------------------------------------------------------------- entries --- */

  let entriesQuery = supabase
    .from("ledger_entries")
    .select(
      "id, payee_type, payee_id, entry_type, amount, currency, period_start, period_end, earning_id, payout_id, commission_scheme_id, description, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);

  if (activeType && activeId) {
    entriesQuery = entriesQuery
      .eq("payee_type", activeType as "model" | "operator")
      .eq("payee_id", activeId);
  }

  const { data: entriesData } = await entriesQuery;
  const entries = (entriesData ?? []) as EntryRow[];

  /* ----------------------------------------------------------------- stats --- */

  const credits = entries.filter((e) => e.amount > 0).reduce((s, e) => s + Number(e.amount), 0);
  const debits = entries.filter((e) => e.amount < 0).reduce((s, e) => s + Number(e.amount), 0);
  const net = credits + debits;

  const selectedBalance = active
    ? balanceRows.find((b) => `${b.payee_type}:${b.payee_id}` === active)
    : null;

  const scopeHint = active ? payeeName.get(active) ?? "Filtered payee" : "All payees";

  return (
    <>
      <PageHeader
        title="Ledger"
        description="The append-only source of truth for what each payee is owed. Balances are SUM(amount) per payee; corrections are reversing entries, never edits (docs/09 §5)."
        breadcrumbs={[{ label: "Ledger" }]}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <ClosePeriodForm />
              <PostEntryForm payees={pickOptions} />
            </div>
          ) : undefined
        }
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile label="Entries" value={entries.length} hint={scopeHint} />
        <StatTile label="Credits" value={money(credits)} hint="Positive movements" />
        <StatTile label="Debits" value={money(debits)} hint="Deductions & settlements" />
        <StatTile
          label={active ? "Payee balance" : "Net (this view)"}
          value={money(active ? Number(selectedBalance?.balance ?? 0) : net)}
          hint={active ? "Owed to payee" : "Credits + debits shown"}
        />
      </StatTileRow>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PayeeFilter current={active ?? "all"} payees={filterOptions} />
        <span className="text-xs text-muted">{entries.length} shown (max 500)</span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No ledger entries"
          description={
            active
              ? "This payee has no ledger movements in view. Clear the filter to see the full journal."
              : canWrite
                ? "Nothing posted yet. Close a period to generate earning-share credits, or post a manual adjustment."
                : "Nothing posted yet. Ledger movements will appear here as they are recorded."
          }
        />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Payee</TH>
              <TH>Type</TH>
              <TH>Details</TH>
              <TH align="right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {entries.map((e) => {
              const meta = ENTRY_META[e.entry_type];
              const key = `${e.payee_type}:${e.payee_id}`;
              const provenance: string[] = [];
              if (e.period_start && e.period_end) {
                provenance.push(`Period ${e.period_start} → ${e.period_end}`);
              }
              if (e.earning_id) provenance.push("from earning");
              if (e.payout_id) provenance.push("from payout");
              if (e.commission_scheme_id) provenance.push("scheme-priced");

              return (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-muted">{date(e.created_at)}</TD>
                  <TD className="font-medium text-foreground">
                    {payeeName.get(key) ?? `${e.payee_type} · ${e.payee_id.slice(0, 8)}`}
                  </TD>
                  <TD>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </TD>
                  <TD className="text-muted">
                    {e.description ? <span className="text-foreground">{e.description}</span> : null}
                    {e.description && provenance.length > 0 ? " · " : null}
                    {provenance.length > 0 ? (
                      <span className="text-xs">{provenance.join(" · ")}</span>
                    ) : !e.description ? (
                      <span className="text-xs">—</span>
                    ) : null}
                  </TD>
                  <TD numeric>
                    <span className={e.amount < 0 ? "text-danger" : "text-foreground"}>
                      {money(e.amount, e.currency, { signed: true })}
                    </span>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
