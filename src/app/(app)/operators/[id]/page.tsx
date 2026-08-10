import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/guard";
import { date, EM_DASH } from "@/lib/format";

import {
  AssignmentEditor,
  type AssignmentRow,
  type ModelOption,
} from "../assignment-editor";
import { OperatorForm, type EditableOperator } from "../operator-form";
import { OperatorStatusControl } from "../operator-status-control";
import {
  assignmentActivity,
  OPERATOR_STATUS_META,
  type AssignmentActivity,
  type OperatorStatus,
} from "../status";

export const metadata: Metadata = { title: "Operator" };

type OperatorDetail = EditableOperator & {
  status: OperatorStatus;
  profile_id: string | null;
  created_at: string;
};

type AssignmentQueryRow = {
  id: string;
  model_id: string;
  pool_share_percent: number;
  assigned_from: string;
  assigned_to: string | null;
  notes: string | null;
};

/** Stable ordering: active, then upcoming, then ended; newest window first. */
const ACTIVITY_RANK: Record<AssignmentActivity, number> = {
  active: 0,
  upcoming: 1,
  ended: 2,
};

/**
 * Operator detail — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * Reads the operator, its assignments, and the model directory through the
 * caller's own RLS-scoped client. The assignment editor's create/edit/remove
 * mutations live in `../actions.ts`, each re-guarded before any write; the DB's
 * pool-sum trigger and overlap-exclusion constraint (docs/04 §4.8) are the
 * authority and their errors surface as toasts.
 */
export default async function OperatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireRole("super_admin", "manager");

  const [operatorResult, assignmentsResult, modelsResult] = await Promise.all([
    supabase
      .from("operators")
      .select(
        "id, display_name, legal_name, email, phone, country, start_date, notes, status, profile_id, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("operator_assignments")
      .select("id, model_id, pool_share_percent, assigned_from, assigned_to, notes")
      .eq("operator_id", id)
      .order("assigned_from", { ascending: false }),
    supabase.from("models").select("id, stage_name").order("stage_name", { ascending: true }),
  ]);

  const operator = operatorResult.data as OperatorDetail | null;
  if (!operator) {
    notFound();
  }

  const models = (modelsResult.data ?? []) as ModelOption[];
  const modelNames = new Map(models.map((m) => [m.id, m.stage_name]));

  const today = new Date().toISOString().slice(0, 10);

  const assignments: AssignmentRow[] = ((assignmentsResult.data ?? []) as AssignmentQueryRow[])
    .map((row) => ({
      id: row.id,
      model_id: row.model_id,
      model_name: modelNames.get(row.model_id) ?? "Unknown model",
      pool_share_percent: row.pool_share_percent,
      assigned_from: row.assigned_from,
      assigned_to: row.assigned_to,
      notes: row.notes,
      activity: assignmentActivity(row.assigned_from, row.assigned_to, today),
    }))
    .sort((a, b) => {
      const rank = ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity];
      return rank !== 0 ? rank : b.assigned_from.localeCompare(a.assigned_from);
    });

  const statusMeta = OPERATOR_STATUS_META[operator.status];

  const editable: EditableOperator = {
    id: operator.id,
    display_name: operator.display_name,
    legal_name: operator.legal_name,
    email: operator.email,
    phone: operator.phone,
    country: operator.country,
    start_date: operator.start_date,
    notes: operator.notes,
  };

  return (
    <>
      <PageHeader
        title={operator.display_name}
        description="Operator business record, model assignments, and pool shares."
        breadcrumbs={[{ label: "Operators", href: "/operators" }, { label: operator.display_name }]}
        actions={
          <>
            <Badge variant={statusMeta.variant} dot>
              {statusMeta.label}
            </Badge>
            <OperatorStatusControl operatorId={operator.id} status={operator.status} />
            <OperatorForm mode="edit" operator={editable} />
          </>
        }
      />

      <div className="mb-6">
        <Card>
          <CardHeader title="Profile" description="Sensitive fields are visible to Super Admin and Managers only." />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Legal name">{operator.legal_name}</Detail>
              <Detail label="Email">{operator.email ?? EM_DASH}</Detail>
              <Detail label="Phone">{operator.phone ?? EM_DASH}</Detail>
              <Detail label="Country">{operator.country ?? EM_DASH}</Detail>
              <Detail label="Start date">
                {operator.start_date ? date(operator.start_date) : EM_DASH}
              </Detail>
              <Detail label="Self-service login">
                {operator.profile_id ? (
                  <Badge variant="primary">Linked</Badge>
                ) : (
                  <span className="text-muted">Not linked</span>
                )}
              </Detail>
              <Detail label="Created">{date(operator.created_at)}</Detail>
              <Detail label="Notes" full>
                {operator.notes ? (
                  <span className="whitespace-pre-wrap">{operator.notes}</span>
                ) : (
                  <span className="text-muted">{EM_DASH}</span>
                )}
              </Detail>
            </dl>
          </CardBody>
        </Card>
      </div>

      <AssignmentEditor operatorId={operator.id} assignments={assignments} models={models} />
    </>
  );
}

function Detail({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}
