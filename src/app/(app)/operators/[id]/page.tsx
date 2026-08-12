import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/guard";
import { EM_DASH } from "@/lib/format";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import {
  AssignmentEditor,
  type AssignmentRow,
  type ModelOption,
} from "../assignment-editor";
import { OperatorForm, type EditableOperator } from "../operator-form";
import { OperatorStatusControl } from "../operator-status-control";
import {
  assignmentActivity,
  operatorStatusMeta,
  type AssignmentActivity,
  type OperatorStatus,
} from "../status";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).studio.operators.detailMetaTitle };
}

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
  const d = await getDict();
  const fm = fmt(await getLocale());

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
      model_name: modelNames.get(row.model_id) ?? d.studio.operators.unknownModel,
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

  const statusMeta = operatorStatusMeta(d, operator.status);

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
        description={d.studio.operators.detailDescription}
        breadcrumbs={[
          { label: d.studio.operators.title, href: "/operators" },
          { label: operator.display_name },
        ]}
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
          <CardHeader
            title={d.studio.operators.profileTitle}
            description={d.studio.operators.profileDescription}
          />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label={d.studio.operators.rowLegalName}>{operator.legal_name}</Detail>
              <Detail label={d.studio.operators.rowEmail}>{operator.email ?? EM_DASH}</Detail>
              <Detail label={d.studio.operators.rowPhone}>{operator.phone ?? EM_DASH}</Detail>
              <Detail label={d.studio.operators.rowCountry}>
                {operator.country ?? EM_DASH}
              </Detail>
              <Detail label={d.studio.operators.rowStartDate}>
                {operator.start_date ? fm.date(operator.start_date) : EM_DASH}
              </Detail>
              <Detail label={d.studio.operators.rowSelfService}>
                {operator.profile_id ? (
                  <Badge variant="primary">{d.studio.operators.linked}</Badge>
                ) : (
                  <span className="text-muted">{d.studio.operators.notLinked}</span>
                )}
              </Detail>
              <Detail label={d.studio.operators.rowCreated}>
                {fm.date(operator.created_at)}
              </Detail>
              <Detail label={d.studio.operators.rowNotes} full>
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
