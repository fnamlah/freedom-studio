import { redirect } from "next/navigation";

import { readSession } from "@/lib/auth/guard";
import { APP_ROUTES, AUTH_ROUTES } from "@/lib/auth/routes";

export const dynamic = "force-dynamic";

/**
 * Entry point. There is no public landing page — the studio app is invite-only
 * (docs/05-auth-2fa.md §1), so `/` only ever routes onward.
 */
export default async function RootPage() {
  const state = await readSession();

  if (state.status === "ready") {
    redirect(APP_ROUTES.dashboard);
  }
  if (state.status === "under_assured") {
    redirect(state.needsEnrollment ? AUTH_ROUTES.mfaEnroll : AUTH_ROUTES.mfaChallenge);
  }
  redirect(AUTH_ROUTES.login);
}
