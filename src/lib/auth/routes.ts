/**
 * Route constants shared by `middleware.ts` (edge runtime) and the server guard.
 *
 * This module MUST stay dependency-free — the middleware bundle cannot import
 * `next/headers`, React, or anything Node-only.
 */

export const AUTH_ROUTES = {
  login: "/auth/login",
  accept: "/auth/accept",
  callback: "/auth/callback",
  mfaEnroll: "/auth/mfa-enroll",
  mfaChallenge: "/auth/mfa-challenge",
  signOut: "/auth/sign-out",
} as const;

export const APP_ROUTES = {
  home: "/",
  dashboard: "/dashboard",
  forbidden: "/forbidden",
} as const;

/** Everything under this prefix is exempt from the app-surface redirects. */
export const AUTH_PREFIX = "/auth";

/**
 * The only routes reachable with NO session (docs/05-auth-2fa.md §5, layer 1).
 * Everything else redirects to `/auth/login`.
 */
export const ANONYMOUS_ALLOWED_PATHS: readonly string[] = [
  AUTH_ROUTES.login,
  AUTH_ROUTES.accept,
  AUTH_ROUTES.callback,
];

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PREFIX || pathname.startsWith(`${AUTH_PREFIX}/`);
}

export function isAnonymousAllowed(pathname: string): boolean {
  return ANONYMOUS_ALLOWED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

/** Builds `/auth/login?next=<original path>` so the user lands back where they were. */
export function loginWithNext(pathname: string, search = ""): string {
  const target = `${pathname}${search}`;
  if (!target || target === "/" || isAuthPath(pathname)) return AUTH_ROUTES.login;
  return `${AUTH_ROUTES.login}?next=${encodeURIComponent(target)}`;
}
