"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { Database } from "@/lib/database.types";
import { dateTime, EM_DASH, isoDate } from "@/lib/format";

import { deactivateUser, resetUserMfa } from "./actions";

type UserStatus = Database["public"]["Enums"]["user_status"];

export type AdminUserRow = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  status: UserStatus;
  deactivated_at: string | null;
  created_at: string;
};

type PendingAction = { kind: "deactivate" | "reset"; user: AdminUserRow };

const ROLE_BADGE: Record<Role, BadgeVariant> = {
  super_admin: "primary",
  manager: "neutral",
  finance: "neutral",
  model: "muted",
  operator: "muted",
};

const STATUS_BADGE: Record<UserStatus, { variant: BadgeVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  invited: { variant: "warning", label: "Invited" },
  deactivated: { variant: "danger", label: "Deactivated" },
};

export function UsersTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isRunning, startTransition] = useTransition();

  if (users.length === 0) {
    return (
      <EmptyState
        title="No users yet"
        description="Users appear here once they accept an invitation and enroll their authenticator."
      />
    );
  }

  function confirm() {
    if (!pending) return;
    const action = pending;
    startTransition(async () => {
      const result =
        action.kind === "deactivate"
          ? await deactivateUser({ userId: action.user.id })
          : await resetUserMfa({ userId: action.user.id });

      if (result.ok) {
        success(
          action.kind === "deactivate" ? "User deactivated" : "MFA reset",
          result.message,
        );
        setPending(null);
        router.refresh();
      } else {
        error("Action failed", result.error);
      }
    });
  }

  const dialogCopy =
    pending?.kind === "deactivate"
      ? {
          title: "Deactivate user",
          body: (
            <>
              <p>
                <strong className="text-foreground">{pending.user.full_name}</strong> will lose
                all access immediately. Their status becomes{" "}
                <em>deactivated</em> and every active session is revoked.
              </p>
              <p className="mt-2 text-muted">
                Re-enabling an account is done from the Supabase Dashboard. This is recorded in
                the audit log.
              </p>
            </>
          ),
          cta: "Deactivate",
        }
      : pending
        ? {
            title: "Reset MFA factor",
            body: (
              <>
                <p>
                  Delete{" "}
                  <strong className="text-foreground">{pending.user.full_name}</strong>&rsquo;s
                  authenticator factor and revoke their sessions. On next login they are forced
                  to re-enroll a new TOTP factor.
                </p>
                <p className="mt-2 text-muted">
                  Only do this after verifying their identity out-of-band (docs/05 §8.1). This is
                  recorded in the audit log.
                </p>
              </>
            ),
            cta: "Reset MFA",
          }
        : null;

  return (
    <>
      <Table containerClassName="rounded-lg border border-border">
        <THead>
          <TR>
            <TH>User</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Joined</TH>
            <TH align="right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const isSuperAdmin = user.role === "super_admin";
            const isDeactivated = user.status === "deactivated";
            const statusMeta = STATUS_BADGE[user.status];
            const canAct = !isSelf && !isSuperAdmin;

            return (
              <TR key={user.id}>
                <TD>
                  <div className="font-medium text-foreground">{user.full_name}</div>
                  <div className="text-xs text-muted">{user.email}</div>
                </TD>
                <TD>
                  <Badge variant={ROLE_BADGE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                </TD>
                <TD>
                  <Badge variant={statusMeta.variant} dot>
                    {statusMeta.label}
                  </Badge>
                  {isDeactivated && user.deactivated_at ? (
                    <div className="mt-1 text-xs text-muted">
                      {isoDate(user.deactivated_at)}
                    </div>
                  ) : null}
                </TD>
                <TD className="text-muted">{dateTime(user.created_at)}</TD>
                <TD align="right">
                  {canAct ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => setPending({ kind: "reset", user })}
                      >
                        Reset MFA
                      </Button>
                      {!isDeactivated ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isRunning}
                          onClick={() => setPending({ kind: "deactivate", user })}
                        >
                          Deactivate
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted">{isSelf ? "You" : EM_DASH}</span>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Dialog
        open={pending !== null}
        onClose={() => {
          if (!isRunning) setPending(null);
        }}
        dismissible={!isRunning}
        title={dialogCopy?.title}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPending(null)}
              disabled={isRunning}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.kind === "deactivate" ? "danger" : "primary"}
              onClick={confirm}
              loading={isRunning}
            >
              {dialogCopy?.cta}
            </Button>
          </>
        }
      >
        <div className="text-sm text-foreground">{dialogCopy?.body}</div>
      </Dialog>
    </>
  );
}
