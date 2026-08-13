import { cache, createElement, type ReactElement } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { ForbiddenView } from "@/components/ui/forbidden";
import { AuthzError } from "@/lib/auth/errors";
import { decodeJwtPayload, isAal2FromClaims, type SessionClaims } from "@/lib/auth/claims";
import { getAssurance } from "@/lib/auth/mfa";
import type { Role } from "@/lib/auth/roles";
import { AUTH_ROUTES, APP_ROUTES } from "@/lib/auth/routes";
import type { Database } from "@/lib/database.types";
import { createServerSupabase, type ServerSupabaseClient } from "@/lib/supabase/server";

/* ------------------------------------------------------------------ types */

/**
 * Role vocabulary lives in `@/lib/auth/roles` (client-safe) and is re-exported
 * here so server code has one import site. CLIENT components must import from
 * `@/lib/auth/roles` — this module pulls in `next/headers`.
 */
export { ROLES, isRole, type Role } from "@/lib/auth/roles";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * A fully-verified caller: signed in, AAL2, `profiles.status = 'active'`.
 * This is what every guarded server component / action receives.
 */
export type AuthContext = {
  supabase: ServerSupabaseClient;
  user: User;
  profile: Profile;
  /** Convenience alias for `profile.role` — the value the app trusts. */
  role: Role;
  claims: SessionClaims;
};

/** Result of `readSession()`, for callers that need to branch on WHY a session fails. */
export type SessionState =
  | { status: "anonymous"; supabase: ServerSupabaseClient }
  | {
      status: "under_assured";
      supabase: ServerSupabaseClient;
      user: User;
      claims: SessionClaims;
      /** No verified TOTP factor exists → forced enrollment. */
      needsEnrollment: boolean;
      /** A verified factor exists but this session has not used it → challenge. */
      needsChallenge: boolean;
    }
  | { status: "no_profile"; supabase: ServerSupabaseClient; user: User; claims: SessionClaims }
  | {
      status: "inactive";
      supabase: ServerSupabaseClient;
      user: User;
      profile: Profile;
      claims: SessionClaims;
    }
  | ({ status: "ready" } & AuthContext);

/* ------------------------------------------------------------ primitives */

export { isAal2FromClaims };
export { AuthzError, isAuthzError, type AuthzErrorCode } from "@/lib/auth/errors";
export type { SessionClaims } from "@/lib/auth/claims";

/**
 * Resolves the caller's full session state exactly once per request.
 *
 * Identity comes from `auth.getUser()` (validated against the Auth server); the
 * `aal` claim is then read off that already-validated access token. Reminder
 * from docs/02 §3: this is a trust-zone-2 convenience — RLS remains the final
 * authority, so a caller that bypasses this still reads zero rows.
 */
export const readSession = cache(async function readSession(): Promise<SessionState> {
  const supabase = await createServerSupabase();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (userError || !user) {
    return { status: "anonymous", supabase };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const decoded = accessToken ? decodeJwtPayload(accessToken) : null;
  const claims: SessionClaims = {
    ...(decoded ?? {}),
    sub: user.id,
    email: user.email ?? null,
  };

  if (!isAal2FromClaims(claims)) {
    const assurance = await getAssurance(supabase);
    return {
      status: "under_assured",
      supabase,
      user,
      claims,
      needsEnrollment: assurance.needsEnrollment || assurance.nextLevel !== "aal2",
      needsChallenge: assurance.needsChallenge,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { status: "no_profile", supabase, user, claims };
  }

  if (profile.status !== "active") {
    return { status: "inactive", supabase, user, profile, claims };
  }

  return { status: "ready", supabase, user, profile, role: profile.role, claims };
});

/* ---------------------------------------------------------------- guards */

/**
 * Optional-context reader: returns the verified `AuthContext`, or `null` when the
 * caller is anonymous / under-assured / inactive. Never redirects, never throws.
 * Use it in layouts and components that render for both states.
 */
export async function getSessionProfile(): Promise<AuthContext | null> {
  const state = await readSession();
  if (state.status !== "ready") return null;
  const { supabase, user, profile, role, claims } = state;
  return { supabase, user, profile, role, claims };
}

/**
 * Requires a signed-in, AAL2, active caller. Redirects otherwise:
 *   no session       → /auth/login
 *   AAL1, no factor  → /auth/mfa-enroll
 *   AAL1, has factor → /auth/mfa-challenge
 *   inactive/no row  → /auth/login (the account cannot use the app)
 *
 * ```ts
 * const { supabase, user, profile } = await requireUser();
 * ```
 */
export async function requireUser(): Promise<AuthContext> {
  const state = await readSession();

  if (state.status === "anonymous") {
    redirect(AUTH_ROUTES.login);
  }
  if (state.status === "under_assured") {
    redirect(state.needsEnrollment ? AUTH_ROUTES.mfaEnroll : AUTH_ROUTES.mfaChallenge);
  }
  if (state.status === "no_profile") {
    redirect(`${AUTH_ROUTES.login}?error=no_profile`);
  }
  if (state.status === "inactive") {
    redirect(`${AUTH_ROUTES.login}?error=inactive`);
  }

  const { supabase, user, profile, role, claims } = state;
  return { supabase, user, profile, role, claims };
}

/**
 * `requireUser()` plus a role check against the capability matrix
 * (docs/03-roles-rbac.md §3). Wrong role → redirect to the Forbidden surface.
 *
 * ```ts
 * const { supabase, profile } = await requireRole("super_admin", "manager");
 * ```
 */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const context = await requireUser();
  if (roles.length > 0 && !roles.includes(context.role)) {
    redirect(`${APP_ROUTES.forbidden}?required=${encodeURIComponent(roles.join(","))}`);
  }
  return context;
}

/**
 * Route-handler / server-action variant of `requireRole()`: throws a typed
 * `AuthzError` (with an HTTP `status`) instead of issuing a redirect, because a
 * 3xx is useless to a `fetch()` caller.
 *
 * ```ts
 * try {
 *   const { supabase } = await requireApiRole("finance");
 * } catch (e) {
 *   if (isAuthzError(e)) return Response.json(e.toResponseBody(), { status: e.status });
 *   throw e;
 * }
 * ```
 */
export async function requireApiRole(...roles: Role[]): Promise<AuthContext> {
  const state = await readSession();

  if (state.status === "anonymous") throw new AuthzError("unauthenticated");
  if (state.status === "under_assured") throw new AuthzError("aal2_required");
  if (state.status === "no_profile") throw new AuthzError("profile_missing");
  if (state.status === "inactive") throw new AuthzError("profile_inactive");

  if (roles.length > 0 && !roles.includes(state.role)) {
    throw new AuthzError("forbidden");
  }

  const { supabase, user, profile, role, claims } = state;
  return { supabase, user, profile, role, claims };
}

/* ------------------------------------------------------------- forbidden */

export type ForbiddenOptions = {
  title?: string;
  message?: string;
  /** Roles that WOULD have been allowed — rendered as a hint for the user. */
  requiredRoles?: readonly Role[];
  /** Where the "Back to dashboard" action points. Defaults to /dashboard. */
  backHref?: string;
};

/**
 * Renders the standard 403 surface. Use it when a page can render partially and
 * only one section must be denied; otherwise prefer `requireRole()`, which
 * redirects to `/forbidden` for you.
 *
 * ```tsx
 * if (profile.role !== "super_admin") return forbidden({ requiredRoles: ["super_admin"] });
 * ```
 */
export function forbidden(options: ForbiddenOptions = {}): ReactElement {
  return createElement(ForbiddenView, {
    title: options.title,
    message: options.message,
    requiredRoles: options.requiredRoles ? [...options.requiredRoles] : undefined,
    backHref: options.backHref ?? APP_ROUTES.dashboard,
  });
}
