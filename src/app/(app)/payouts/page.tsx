import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { money } from "@/lib/format";

import { PayeeFilter, type PayeeOption } from "../ledger/payee-filter";
import {
  CreatePayoutForm,
  type PayeeBalance,
  type PayeePickOption,
} from "./create-payout-form";
import { PayoutsTable, type PayoutRowView } from "./payouts-table";

export const metadata: Metadata = { title: "Payouts" };

type PayoutStatus = "pending" | "approved" | "paid" | "cancelled";

type PayoutQueryRow = {
  id: string;
  payee_type: "model" | "operator";
  payee_id: string;
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
 * Payouts — the maker-checker payment workflow (docs/09 §6). Readable by every
 * role, RLS-scoped (SA/MGR/FIN see all; model/operator see own). Create is SA/MGR/
 * FIN; approve is SUPER ADMIN ONLY; mark-paid is FIN/SA and triggers the settlement
 * ledger entry. All transitions re-guard in `./actions.ts` and are DB-enforced.
 */
export default async function PayoutsPage({
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

  const canCreate = role === "super_admin" || role === "manager" || role === "finance";

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

  const balanceMap: Record<string, PayeeBalance> = {};
  for (const b of balanceRows) {
    if (b.payee_type && b.payee_id) {
      balanceMap[`${b.payee_type}:${b.payee_id}`] = {
        balance: Number(b.balance ?? 0),
        currency: b.currency ?? "USD",
      };
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

  /* ---------------------------------------------------------------- payouts --- */

  let query = supabase
    .from("payouts")
    .select(
      "id, payee_type, payee_id, period_start, period_end, gross_amount, studio_fee_amount, deductions, net_amount, currency, status, reference, paid_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (activeType && activeId) {
    query = query.eq("payee_type", activeType as "model" | "operator").eq("payee_id", activeId);
  }

  const { data: payoutsData } = await query;
  const payouts = (payoutsData ?? []) as PayoutQueryRow[];

  const rows: PayoutRowView[] = payouts.map((p) => ({
    id: p.id,
    payee_name:
      payeeName.get(`${p.payee_type}:${p.payee_id}`) ??
      `${p.payee_type} · ${p.payee_id.slice(0, 8)}`,
    period_start: p.period_start,
    period_end: p.period_end,
    gross_amount: p.gross_amount,
    studio_fee_amount: p.studio_fee_amount,
    deductions: p.deductions,
    net_amount: p.net_amount,
    currency: p.currency,
    status: p.status,
    reference: p.reference,
    paid_at: p.paid_at,
    created_at: p.created_at,
  }));

  /* ----------------------------------------------------------------- stats --- */

  const count = (s: PayoutStatus) => payouts.filter((p) => p.status === s).length;
  const pendingNet = payouts
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + Number(p.net_amount ?? 0), 0);
  const approvedNet = payouts
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + Number(p.net_amount ?? 0), 0);
  const paidNet = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.net_amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Maker-checker payments: finance/manager create, the Super Admin approves, finance settles. Marking paid posts the settlement ledger entry automatically (docs/09 §6)."
        breadcrumbs={[{ label: "Payouts" }]}
        actions={
          canCreate ? <CreatePayoutForm payees={pickOptions} balances={balanceMap} /> : undefined
        }
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile label="Pending" value={count("pending")} hint={money(pendingNet)} />
        <StatTile label="Approved" value={count("approved")} hint={`${money(approvedNet)} to settle`} />
        <StatTile label="Paid" value={count("paid")} hint={money(paidNet)} />
        <StatTile label="Total" value={payouts.length} hint={active ? "Filtered payee" : "All payees"} />
      </StatTileRow>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PayeeFilter current={active ?? "all"} payees={filterOptions} basePath="/payouts" />
        <span className="text-xs text-muted">{rows.length} shown (max 500)</span>
      </div>

      <PayoutsTable rows={rows} role={role} />
    </>
  );
}
