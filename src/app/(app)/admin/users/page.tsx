import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { requireRole } from "@/lib/auth/guard";
import { getDict } from "@/lib/i18n/server";

import { UsersTable, type AdminUserRow } from "./users-table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.users.metaTitle };
}

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
  const dict = await getDict();
  const d = dict.adminAi.users;

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
        title={d.title}
        description={d.description}
        breadcrumbs={[{ label: dict.nav.sectionAdmin }, { label: d.title }]}
      />

      <StatTileRow className="mb-6" columns={3}>
        <StatTile label={d.statActive} value={activeCount} hint={d.statActiveHint} />
        <StatTile label={d.statInvited} value={invitedCount} hint={d.statInvitedHint} />
        <StatTile
          label={d.statDeactivated}
          value={deactivatedCount}
          hint={d.statDeactivatedHint}
        />
      </StatTileRow>

      <UsersTable users={users} currentUserId={user.id} />
    </>
  );
}
