import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Authenticated route group.
 *
 * `requireUser()` runs before anything renders, so every page under `(app)/` can
 * assume a signed-in, AAL2, active caller. Pages that need a narrower audience
 * call `requireRole(...)` themselves — the layout guard is the floor, not the
 * ceiling, and neither replaces RLS.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();

  return (
    <AppShell fullName={profile.full_name} email={profile.email} role={profile.role}>
      {children}
    </AppShell>
  );
}
