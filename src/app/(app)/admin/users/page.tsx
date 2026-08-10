import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";

import { UsersTable, type AdminUserRow } from "./users-table";

export const metadata: Metadata = { title: "Users" };

/**
 * Super-Admin-only user administration surface (docs/03 §3, docs/05 §8).
 *
 * The list is read through the caller's own RLS-scoped client — `super_admin`
 * reads all `profiles` rows (docs/04 §7.2). Deactivation and MFA reset happen in
 * `./actions.ts`, which re-verifies the caller via `guardedAdminClient` before
 * touching the service role.
 */
export default async function AdminUsersPage() {
  const { supabase, user } = await requireRole("super_admin");

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status, deactivated_at, created_at")
    .order("created_at", { ascending: true });

  const users = (data ?? []) as AdminUserRow[];

  const activeCount = users.filter((u) => u.status === "active").length;
  const invitedCount = users.filter((u) => u.status === "invited").length;
  const deactivatedCount = users.filter((u) => u.status === "deactivated").length;

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account in the studio. Deactivate access or reset a lost authenticator — both are audited."
        breadcrumbs={[{ label: "Admin" }, { label: "Users" }]}
      />

      <StatTileRow className="mb-6" columns={3}>
        <StatTile label="Active" value={activeCount} hint="Enrolled and able to sign in" />
        <StatTile label="Invited" value={invitedCount} hint="Awaiting first enrollment" />
        <StatTile label="Deactivated" value={deactivatedCount} hint="Access revoked" />
      </StatTileRow>

      <UsersTable users={users} currentUserId={user.id} />
    </>
  );
}
