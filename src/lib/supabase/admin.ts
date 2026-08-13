import type { User } from "@supabase/supabase-js";

import { decodeJwtPayload, isAal2FromClaims, type SessionClaims } from "@/lib/auth/claims";
import { AuthzError } from "@/lib/auth/errors";
import type { Database } from "@/lib/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  createServiceRoleClient,
  hasServiceRoleKey,
  type ServiceRoleClient,
} from "@/lib/supabase/service-internal";

/**
 * The ONLY sanctioned path to a service-role (RLS-bypassing) Supabase client.
 *
 * There is deliberately NO bare service client export in this module. Per the
 * boxed invariant in docs/05-auth-2fa.md §7 and ADR-02 in docs/02-architecture.md,
 * the privilege must be preceded — in the same server invocation — by:
 *
 *   1. a real session (`auth.getUser()`, validated against the Auth server),
 *   2. an AAL2 assurance check on that session's `aal` claim,
 *   3. `profiles.status = 'active'`,
 *   4. `profiles.role ∈ allowedRoles`.
 *
 * Only then is the service-role client constructed and returned.
 */

export type Role = Database["public"]["Enums"]["user_role"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type GuardedAdminContext = {
  /** Service-role client. BYPASSES RLS — scope every query yourself. */
  admin: ServiceRoleClient;
  user: User;
  profile: Profile;
  role: Role;
  claims: SessionClaims;
};

export { AuthzError, isAuthzError, type AuthzErrorCode } from "@/lib/auth/errors";
export type { ServiceRoleClient } from "@/lib/supabase/service-internal";

/**
 * Verifies the caller, then returns an elevated client.
 *
 * ```ts
 * // Super-Admin-only user administration (docs/03 §3).
 * const { admin, profile } = await guardedAdminClient(["super_admin"]);
 * await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
 * await writeAudit({ action: "user.invite", entityType: "invitation", entityId: id });
 * ```
 *
 * @throws {AuthzError} `unauthenticated` | `aal2_required` | `profile_missing`
 *                      | `profile_inactive` | `forbidden` | `misconfigured`
 */
export async function guardedAdminClient(
  allowedRoles: Role[],
): Promise<GuardedAdminContext> {
  if (typeof window !== "undefined") {
    throw new AuthzError("misconfigured", "guardedAdminClient is server-only.");
  }
  if (!hasServiceRoleKey()) {
    throw new AuthzError("misconfigured", "SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    // Refuse to elevate for an unbounded role set — deny by default.
    throw new AuthzError("forbidden", "guardedAdminClient requires an explicit role list.");
  }

  const supabase = await createServerSupabase();

  // 1. Identity — validated against the Auth server, not read from a cookie.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (userError || !user) {
    throw new AuthzError("unauthenticated");
  }

  // 2. Assurance — the `aal` claim on the token we just validated.
  const claims = await readClaims(supabase, user);
  if (!isAal2FromClaims(claims)) {
    throw new AuthzError("aal2_required");
  }

  // 3 + 4. Profile status and role, read through the caller's own RLS.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new AuthzError("profile_missing");
  }
  if (profile.status !== "active") {
    throw new AuthzError("profile_inactive");
  }
  if (!allowedRoles.includes(profile.role)) {
    throw new AuthzError("forbidden");
  }

  // Only now is the privileged credential materialised.
  return {
    admin: createServiceRoleClient(),
    user,
    profile,
    role: profile.role,
    claims,
  };
}

async function readClaims(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  user: User,
): Promise<SessionClaims> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims) {
      return data.claims as SessionClaims;
    }
  } catch {
    // fall through to the local decode of the already-validated token
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const decoded = token ? decodeJwtPayload(token) : null;

  return {
    ...(decoded ?? {}),
    sub: user.id,
    email: user.email ?? null,
    aal: decoded?.aal ?? null,
  };
}
