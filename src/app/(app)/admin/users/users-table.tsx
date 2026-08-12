"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { roleLabel, type Role } from "@/lib/auth/roles";
import type { Database } from "@/lib/database.types";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { EM_DASH, isoDate } from "@/lib/format";

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

/** Only the colour is fixed here; the label comes from the dictionary per row. */
const STATUS_BADGE: Record<UserStatus, BadgeVariant> = {
  active: "success",
  invited: "warning",
  deactivated: "danger",
};

export function UsersTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const dict = useDict();
  const d = dict.adminAi.users;
  const fm = fmt(locale);
  const { success, error } = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isRunning, startTransition] = useTransition();

  const statusLabel: Record<UserStatus, string> = {
    active: d.statusActive,
    invited: d.statusInvited,
    deactivated: d.statusDeactivated,
  };

  if (users.length === 0) {
    return <EmptyState title={d.emptyTitle} description={d.emptyDescription} />;
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
          action.kind === "deactivate" ? d.toastDeactivated : d.toastMfaReset,
          result.message,
        );
        setPending(null);
        router.refresh();
      } else {
        error(d.toastFailed, result.error);
      }
    });
  }

  // The person's name is interpolated INTO the sentence rather than wrapped in
  // its own <strong>: Russian puts it in a different case and position, and a
  // sentence assembled from translated fragments cannot express that.
  const dialogCopy =
    pending?.kind === "deactivate"
      ? {
          title: d.deactivateTitle,
          body: (
            <>
              <p>{d.deactivateBody(pending.user.full_name)}</p>
              <p className="mt-2 text-muted">{d.deactivateNote}</p>
            </>
          ),
          cta: d.deactivateCta,
        }
      : pending
        ? {
            title: d.resetTitle,
            body: (
              <>
                <p>{d.resetBody(pending.user.full_name)}</p>
                <p className="mt-2 text-muted">{d.resetNote}</p>
              </>
            ),
            cta: d.resetCta,
          }
        : null;

  return (
    <>
      <Table containerClassName="rounded-lg border border-border">
        <THead>
          <TR>
            <TH>{d.colUser}</TH>
            <TH>{d.colRole}</TH>
            <TH>{dict.common.status}</TH>
            <TH>{d.colJoined}</TH>
            <TH align="right">{dict.common.actions}</TH>
          </TR>
        </THead>
        <TBody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const isSuperAdmin = user.role === "super_admin";
            const isDeactivated = user.status === "deactivated";
            const statusVariant = STATUS_BADGE[user.status];
            const canAct = !isSelf && !isSuperAdmin;

            return (
              <TR key={user.id}>
                <TD>
                  <div className="font-medium text-foreground">{user.full_name}</div>
                  <div className="text-xs text-muted">{user.email}</div>
                </TD>
                <TD>
                  <Badge variant={ROLE_BADGE[user.role]}>{roleLabel(locale, user.role)}</Badge>
                </TD>
                <TD>
                  <Badge variant={statusVariant} dot>
                    {statusLabel[user.status]}
                  </Badge>
                  {isDeactivated && user.deactivated_at ? (
                    <div className="mt-1 text-xs text-muted">
                      {isoDate(user.deactivated_at)}
                    </div>
                  ) : null}
                </TD>
                <TD className="text-muted">{fm.dateTime(user.created_at)}</TD>
                <TD align="right">
                  {canAct ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => setPending({ kind: "reset", user })}
                      >
                        {d.resetMfa}
                      </Button>
                      {!isDeactivated ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isRunning}
                          onClick={() => setPending({ kind: "deactivate", user })}
                        >
                          {d.deactivate}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted">{isSelf ? d.self : EM_DASH}</span>
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
              {dict.common.cancel}
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
