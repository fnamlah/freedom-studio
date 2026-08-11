import type { Metadata } from "next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { Database } from "@/lib/database.types";
import { date, EM_DASH } from "@/lib/format";

import { InviteForm, type ModelOption, type OperatorOption } from "./invite-form";

export const metadata: Metadata = { title: "Invitations" };

type InvitationStatus = Database["public"]["Enums"]["invitation_status"];

const STATUS_BADGE: Record<InvitationStatus, { variant: BadgeVariant; label: string }> = {
  pending: { variant: "warning", label: "Pending" },
  accepted: { variant: "success", label: "Accepted" },
  expired: { variant: "muted", label: "Expired" },
  revoked: { variant: "danger", label: "Revoked" },
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
        title="Invitations"
        description="Invite staff, models and operators. Accounts are created only after the invitee sets a password and enrolls TOTP."
        breadcrumbs={[{ label: "Admin" }, { label: "Invitations" }]}
        actions={<InviteForm models={models} operators={operators} />}
      />

      {invitations.length === 0 ? (
        <EmptyState
          title="No invitations yet"
          description="Invite the first user to get started. They receive a one-time link to set a password and enroll two-factor authentication."
          action={<InviteForm models={models} operators={operators} />}
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            {pendingCount} pending {pendingCount === 1 ? "invitation" : "invitations"}.
          </p>
          <Table containerClassName="rounded-lg border border-border">
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Pre-link</TH>
                <TH>Status</TH>
                <TH>Sent</TH>
                <TH>Expires</TH>
              </TR>
            </THead>
            <TBody>
              {invitations.map((invite) => {
                const isExpired =
                  invite.status === "pending" &&
                  new Date(invite.expires_at).getTime() < now;
                const statusMeta = isExpired
                  ? STATUS_BADGE.expired
                  : STATUS_BADGE[invite.status];

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
                      <Badge variant="neutral">{ROLE_LABELS[invite.role as Role]}</Badge>
                    </TD>
                    <TD className="text-muted">{preLink ?? EM_DASH}</TD>
                    <TD>
                      <Badge variant={statusMeta.variant} dot>
                        {statusMeta.label}
                      </Badge>
                    </TD>
                    <TD className="text-muted">{date(invite.created_at)}</TD>
                    <TD className="text-muted">{date(invite.expires_at)}</TD>
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
