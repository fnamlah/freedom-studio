import type { Metadata } from "next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import { roleLabel, type Role } from "@/lib/auth/roles";
import type { Database } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";
import { EM_DASH } from "@/lib/format";

import { InviteForm, type ModelOption, type OperatorOption } from "./invite-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.invitations.metaTitle };
}

type InvitationStatus = Database["public"]["Enums"]["invitation_status"];

/** Colour only; the label is looked up per row against the reader's dictionary. */
const STATUS_BADGE: Record<InvitationStatus, BadgeVariant> = {
  pending: "warning",
  accepted: "success",
  expired: "muted",
  revoked: "danger",
};

/**
 * Super-Admin-only invitation management (docs/05 §3, Flow A).
 *
 * The list is read through the caller's own RLS-scoped client (`super_admin` has
 * CRUD on `invitations`, docs/04 §7.2). Sending an invite happens in
 * `./actions.ts`, re-verified through `guardedAdminClient` before the service
 * role is touched.
 */
export default async function AdminInvitationsPage() {
  const { supabase } = await requireRole("super_admin");
  const locale = await getLocale();
  const dict = await getDict();
  const d = dict.adminAi.invitations;
  const fm = fmt(locale);

  const statusLabel: Record<InvitationStatus, string> = {
    pending: d.statusPending,
    accepted: d.statusAccepted,
    expired: d.statusExpired,
    revoked: d.statusRevoked,
  };

  const [invitationsResult, modelsResult, operatorsResult] = await Promise.all([
    supabase
      .from("invitations")
      .select("id, email, role, status, model_id, operator_id, expires_at, accepted_at, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("models").select("id, stage_name").order("stage_name", { ascending: true }),
    supabase.from("operators").select("id, display_name").order("display_name", { ascending: true }),
  ]);

  const invitations = invitationsResult.data ?? [];
  const models = (modelsResult.data ?? []) as ModelOption[];
  const operators = (operatorsResult.data ?? []) as OperatorOption[];

  const modelNames = new Map(models.map((m) => [m.id, m.stage_name]));
  const operatorNames = new Map(operators.map((o) => [o.id, o.display_name]));

  const now = Date.now();
  const pendingCount = invitations.filter(
    (invite) => invite.status === "pending" && new Date(invite.expires_at).getTime() >= now,
  ).length;

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.description}
        breadcrumbs={[{ label: dict.nav.sectionAdmin }, { label: d.title }]}
        actions={<InviteForm models={models} operators={operators} />}
      />

      {invitations.length === 0 ? (
        <EmptyState
          title={d.emptyTitle}
          description={d.emptyDescription}
          action={<InviteForm models={models} operators={operators} />}
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">{d.pendingCount(pendingCount)}</p>
          <Table containerClassName="rounded-lg border border-border">
            <THead>
              <TR>
                <TH>{d.colEmail}</TH>
                <TH>{d.colRole}</TH>
                <TH>{d.colPreLink}</TH>
                <TH>{dict.common.status}</TH>
                <TH>{d.colSent}</TH>
                <TH>{d.colExpires}</TH>
              </TR>
            </THead>
            <TBody>
              {invitations.map((invite) => {
                const isExpired =
                  invite.status === "pending" &&
                  new Date(invite.expires_at).getTime() < now;
                const effectiveStatus: InvitationStatus = isExpired
                  ? "expired"
                  : invite.status;

                const preLink = invite.model_id
                  ? modelNames.get(invite.model_id)
                  : invite.operator_id
                    ? operatorNames.get(invite.operator_id)
                    : null;

                return (
                  <TR key={invite.id}>
                    <TD>
                      <span className="font-medium text-foreground">{invite.email}</span>
                    </TD>
                    <TD>
                      <Badge variant="neutral">{roleLabel(locale, invite.role as Role)}</Badge>
                    </TD>
                    <TD className="text-muted">{preLink ?? EM_DASH}</TD>
                    <TD>
                      <Badge variant={STATUS_BADGE[effectiveStatus]} dot>
                        {statusLabel[effectiveStatus]}
                      </Badge>
                    </TD>
                    <TD className="text-muted">{fm.date(invite.created_at)}</TD>
                    <TD className="text-muted">{fm.date(invite.expires_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </>
  );
}
