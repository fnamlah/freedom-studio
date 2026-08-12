import type { Metadata } from "next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import type { Enums } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { ClosePeriodForm } from "./close-period-form";
import { PayeeFilter, type PayeeOption } from "./payee-filter";
import { PostEntryForm, type PayeePickOption } from "./post-entry-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).money.ledger.metaTitle };
}

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

/**
 * Badge colour per entry type. The LABEL lives in the dictionary
 * (`d.money.ledger.entryType`) — only the colour is language-independent, so
 * only the colour is a module constant.
 */
const ENTRY_VARIANT: Record<LedgerEntryType, BadgeVariant> = {
  earning_share: "success",
  adjustment: "primary",
  deduction: "warning",
  payout_settlement: "muted",
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
  const d = await getDict();
  const fm = fmt(await getLocale());

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
        label: `${m.stage_name ?? d.money.ledger.fallbackModel} · ${d.money.ledger.payeeType.model}`,
      })),
    ...operators
      .filter((o): o is { id: string; display_name: string } => !!o.id)
      .map((o) => ({
        payee_type: "operator" as const,
        payee_id: o.id,
        label: `${o.display_name ?? d.money.ledger.fallbackOperator} · ${d.money.ledger.payeeType.operator}`,
      })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const payeeName = new Map<string, string>();
  for (const p of pickOptions) payeeName.set(`${p.payee_type}:${p.payee_id}`, p.label);
  for (const b of balanceRows) {
    if (b.payee_type && b.payee_id && b.display_name) {
      const key = `${b.payee_type}:${b.payee_id}`;
      if (!payeeName.has(key)) {
        payeeName.set(key, `${b.display_name} · ${d.money.ledger.payeeType[b.payee_type]}`);
      }
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

  const scopeHint = active
    ? payeeName.get(active) ?? d.money.ledger.filteredPayee
    : d.money.ledger.allPayees;

  return (
    <>
      <PageHeader
        title={d.money.ledger.title}
        description={d.money.ledger.description}
        breadcrumbs={[{ label: d.money.ledger.title }]}
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
        <StatTile
          label={d.money.ledger.statEntries}
          value={fm.number(entries.length)}
          hint={scopeHint}
        />
        <StatTile
          label={d.money.ledger.statCredits}
          value={fm.money(credits)}
          hint={d.money.ledger.statCreditsHint}
        />
        <StatTile
          label={d.money.ledger.statDebits}
          value={fm.money(debits)}
          hint={d.money.ledger.statDebitsHint}
        />
        <StatTile
          label={active ? d.money.ledger.statPayeeBalance : d.money.ledger.statNetThisView}
          value={fm.money(active ? Number(selectedBalance?.balance ?? 0) : net)}
          hint={active ? d.money.ledger.statOwedToPayee : d.money.ledger.statCreditsPlusDebits}
        />
      </StatTileRow>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PayeeFilter current={active ?? "all"} payees={filterOptions} />
        <span className="text-xs text-muted">{d.money.ledger.shown(entries.length)}</span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title={d.money.ledger.emptyTitle}
          description={
            active
              ? d.money.ledger.emptyFiltered
              : canWrite
                ? d.money.ledger.emptyWriter
                : d.money.ledger.emptyReader
          }
        />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>{d.money.ledger.colDate}</TH>
              <TH>{d.money.ledger.colPayee}</TH>
              <TH>{d.money.ledger.colType}</TH>
              <TH>{d.money.ledger.colDetails}</TH>
              <TH align="right">{d.money.ledger.colAmount}</TH>
            </TR>
          </THead>
          <TBody>
            {entries.map((e) => {
              const key = `${e.payee_type}:${e.payee_id}`;
              const provenance: string[] = [];
              if (e.period_start && e.period_end) {
                // Raw ISO on purpose: provenance is a machine-readable stamp,
                // and it has to stay short inside the details column.
                provenance.push(d.money.ledger.provenancePeriod(e.period_start, e.period_end));
              }
              if (e.earning_id) provenance.push(d.money.ledger.provenanceEarning);
              if (e.payout_id) provenance.push(d.money.ledger.provenancePayout);
              if (e.commission_scheme_id) provenance.push(d.money.ledger.provenanceScheme);

              return (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-muted">{fm.date(e.created_at)}</TD>
                  <TD className="font-medium text-foreground">
                    {payeeName.get(key) ??
                      `${d.money.ledger.payeeType[e.payee_type]} · ${e.payee_id.slice(0, 8)}`}
                  </TD>
                  <TD>
                    <Badge variant={ENTRY_VARIANT[e.entry_type]}>
                      {d.money.ledger.entryType[e.entry_type]}
                    </Badge>
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
                      {fm.money(e.amount, e.currency, { signed: true })}
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
