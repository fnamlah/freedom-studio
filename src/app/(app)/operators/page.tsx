import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import { date, EM_DASH } from "@/lib/format";

import { OperatorForm } from "./operator-form";
import { assignmentActivity, OPERATOR_STATUS_META, type OperatorStatus } from "./status";

export const metadata: Metadata = { title: "Operators" };

type OperatorListRow = {
  id: string;
  display_name: string;
  email: string | null;
  country: string | null;
  start_date: string | null;
  status: OperatorStatus;
  profile_id: string | null;
};

type AssignmentLite = {
  operator_id: string;
  assigned_from: string;
  assigned_to: string | null;
};

/**
 * Operators list — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * Read through the caller's own RLS-scoped client (SA/MGR hold full CRUD on
 * `operators`). Creation happens in `./actions.ts`, re-guarded with
 * `requireRole("super_admin","manager")` before any write.
 */
export default async function OperatorsPage() {
  const { supabase } = await requireRole("super_admin", "manager");

  const [operatorsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("operators")
      .select("id, display_name, email, country, start_date, status, profile_id")
      .order("display_name", { ascending: true }),
    supabase.from("operator_assignments").select("operator_id, assigned_from, assigned_to"),
  ]);

  const operators = (operatorsResult.data ?? []) as OperatorListRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentLite[];

  const today = new Date().toISOString().slice(0, 10);

  const totalByOperator = new Map<string, number>();
  const activeByOperator = new Map<string, number>();
  for (const a of assignments) {
    totalByOperator.set(a.operator_id, (totalByOperator.get(a.operator_id) ?? 0) + 1);
    if (assignmentActivity(a.assigned_from, a.assigned_to, today) === "active") {
      activeByOperator.set(a.operator_id, (activeByOperator.get(a.operator_id) ?? 0) + 1);
    }
  }

  const activeCount = operators.filter((o) => o.status === "active").length;
  const assignedCount = operators.filter((o) => (activeByOperator.get(o.id) ?? 0) > 0).length;

  return (
    <>
      <PageHeader
        title="Operators"
        description="Support staff who share in model revenue. Assign them to models with a pool share and period."
        breadcrumbs={[{ label: "Operators" }]}
        actions={<OperatorForm mode="create" />}
      />

      <StatTileRow className="mb-6" columns={3}>
        <StatTile label="Operators" value={operators.length} hint="Total business records" />
        <StatTile label="Active" value={activeCount} hint="Current lifecycle status" />
        <StatTile
          label="Assigned"
          value={assignedCount}
          hint="With an active model assignment"
        />
      </StatTileRow>

      {operators.length === 0 ? (
        <EmptyState
          title="No operators yet"
          description="Add the first operator to start assigning them to models and crediting them a share of the operator pool."
          action={<OperatorForm mode="create" />}
        />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>Operator</TH>
              <TH>Status</TH>
              <TH align="right">Assignments</TH>
              <TH>Country</TH>
              <TH>Started</TH>
            </TR>
          </THead>
          <TBody>
            {operators.map((operator) => {
              const statusMeta = OPERATOR_STATUS_META[operator.status];
              const total = totalByOperator.get(operator.id) ?? 0;
              const active = activeByOperator.get(operator.id) ?? 0;

              return (
                <TR key={operator.id} interactive>
                  <TD>
                    <Link
                      href={`/operators/${operator.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {operator.display_name}
                    </Link>
                    <div className="text-xs text-muted">
                      {operator.email ?? EM_DASH}
                      {operator.profile_id ? (
                        <Badge variant="primary" className="ml-2">
                          Login linked
                        </Badge>
                      ) : null}
                    </div>
                  </TD>
                  <TD>
                    <Badge variant={statusMeta.variant} dot>
                      {statusMeta.label}
                    </Badge>
                  </TD>
                  <TD numeric>
                    {total === 0 ? (
                      <span className="text-muted">{EM_DASH}</span>
                    ) : (
                      <span>
                        {total}
                        {active > 0 ? (
                          <span className="ml-1 text-xs text-success">({active} active)</span>
                        ) : null}
                      </span>
                    )}
                  </TD>
                  <TD className="text-muted">{operator.country ?? EM_DASH}</TD>
                  <TD className="text-muted">
                    {operator.start_date ? date(operator.start_date) : EM_DASH}
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
