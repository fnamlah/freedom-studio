/**
 * Post-auth redirect sanitisation.
 *
 * Client-safe and dependency-free so it can be shared by the auth forms and the
 * server page wrappers. The `?next=` value is attacker-influenced (it rides in a
 * URL the user can be handed), so it is treated as untrusted: only same-origin,
 * in-app paths survive. Anything else falls back to the dashboard.
 */

import { APP_ROUTES, AUTH_PREFIX } from "@/lib/auth/routes";

/** Where a fully-assured user lands when no explicit target is supplied. */
export const DEFAULT_POST_LOGIN: string = APP_ROUTES.dashboard;

/**
 * Returns a safe in-app path to redirect to after authentication.
 *
 * Rejects:
 *  - absolute URLs / protocol-relative (`//evil.com`, `/\evil.com`) — open-redirect vectors;
 *  - anything not rooted at `/`;
 *  - the auth surface itself (`/auth/...`) — would loop the user back into the flow.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return DEFAULT_POST_LOGIN;

  // Must be a root-relative path, not a protocol-relative or backslash trick.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_POST_LOGIN;
  }

  // Never bounce back into the auth flow (login → challenge → login …).
  if (next === AUTH_PREFIX || next.startsWith(`${AUTH_PREFIX}/`)) {
    return DEFAULT_POST_LOGIN;
  }

  return next;
}
