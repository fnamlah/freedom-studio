import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * Access-token claims this application cares about.
 *
 * `aal` is minted by Supabase Auth (`aal1` after password, `aal2` after TOTP).
 * `user_role` is injected by the Custom Access Token Auth Hook (docs/03 §2.1);
 * it is a UX convenience only — the database never trusts it alone, and neither
 * does this app: `profiles.role` loaded through RLS is the value the guard uses.
 */
export type SessionClaims = {
  sub?: string;
  aal?: string | null;
  user_role?: Database["public"]["Enums"]["user_role"] | null;
  email?: string | null;
  session_id?: string | null;
  exp?: number;
  [key: string]: unknown;
};

/**
 * The single place the AAL2 predicate is expressed in application code.
 *
 * NOTE: this is the trust-zone-2 UX check. The authoritative check is the
 * per-table RESTRICTIVE RLS policy defined in docs/05-auth-2fa.md §5 — a caller
 * that defeats this function still reads zero rows.
 */
export function isAal2FromClaims(
  claims: Pick<SessionClaims, "aal"> | null | undefined,
): boolean {
  return claims?.aal === "aal2";
}

/**
 * Decodes a JWT payload WITHOUT verifying its signature.
 *
 * Only ever used as a fallback for reading the `aal` claim off an access token
 * that Supabase Auth has already validated for us (`getUser()` round-trips to
 * the Auth server). Never use it to establish identity.
 */
export function decodeJwtPayload(accessToken: string): SessionClaims | null {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const json =
      typeof atob === "function"
        ? decodeURIComponent(
            atob(padded)
              .split("")
              .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
              .join(""),
          )
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * Reads verified claims for the current session.
 *
 * Primary path is `auth.getClaims()` (verifies the JWT locally against the
 * project JWKS, or server-side for symmetric secrets). If the SDK/project cannot
 * serve it, falls back to `auth.getUser()` — which validates against the Auth
 * server — and then decodes the already-validated token for the `aal` claim.
 *
 * Returns `null` when there is no session.
 */
export async function getSessionClaims(
  supabase: SupabaseClient<Database, "public">,
): Promise<SessionClaims | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims) {
      return data.claims as SessionClaims;
    }
  } catch {
    // fall through to getUser()
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const decoded = token ? decodeJwtPayload(token) : null;

  return {
    ...(decoded ?? {}),
    sub: userData.user.id,
    email: userData.user.email ?? null,
    aal: decoded?.aal ?? null,
  };
}
