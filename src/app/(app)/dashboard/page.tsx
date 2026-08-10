import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireUser, ROLE_LABELS } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * TODO(A-DASH): PLACEHOLDER — replace this whole file.
 *
 * The real dashboard composes per-role widgets from docs/07-analytics.md §5:
 *   super_admin — every widget in the §4 chart-mapping table
 *   manager     — as SA minus split distribution, forecast accuracy, payee
 *                 balances and the AI insight panel
 *   model       — own earnings trend, own platform-share pie, own hours trend,
 *                 own payout history, own compliance donut, own KPI tiles
 *   operator    — own share trend (ledger `earning_share` credits), own payouts,
 *                 own balance tile. NEVER raw earnings.
 *   finance     — earnings trends, split distribution, projected-vs-actual,
 *                 forecast breakdown + accuracy, payout history, payee balances,
 *                 AI insight panel. NO documents/compliance widget.
 *
 * Data comes from the SECURITY INVOKER views/RPCs in docs/07 §2–3, queried with
 * `supabase` from `requireUser()` — never a service-role client. Charts live in
 * `@/components/charts`; tiles in `@/components/ui`.
 */
export default async function DashboardPage() {
  const { profile } = await requireUser();

  return (
    <>
      <PageHeader
        title={`Welcome back, ${profile.full_name.split(" ")[0]}`}
        description={`Signed in as ${ROLE_LABELS[profile.role]}. Your dashboard shows only what your role permits.`}
      />

      <StatTileRow className="mb-6">
        <StatTile label="Period gross" value="—" hint="Awaiting data" />
        <StatTile label="Period net" value="—" hint="Awaiting data" />
        <StatTile label="Hours worked" value="—" hint="Awaiting data" />
        <StatTile label="Pending payouts" value="—" hint="Awaiting data" />
      </StatTileRow>

      <EmptyState
        title="Dashboard widgets are not wired up yet"
        description="This placeholder will be replaced by the per-role widget composition specified in docs/07-analytics.md §5."
      />
    </>
  );
}
