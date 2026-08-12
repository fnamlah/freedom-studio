"use server";

import { getSessionClaims, isAal2FromClaims } from "@/lib/auth/claims";
import { listTotpFactors } from "@/lib/auth/mfa";
import { writeAudit } from "@/lib/audit";
import { getDict } from "@/lib/i18n/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-internal";

/**
 * Activates the CURRENT user's profile after they enroll and verify their first
 * TOTP factor (docs/05-auth-2fa.md Flow A tail).
 *
 * ── Why this needs a service-role write, and why it is NOT `guardedAdminClient` ──
 * At this instant the caller's session is AAL2, but their `profiles.status` is
 * still `invited`. The restrictive AAL2-AND-active RLS policy (docs/05 §5)
 * therefore denies the caller EVERY row — they cannot update their own profile
 * through their RLS client. And `guardedAdminClient()` refuses too: its guard
 * requires `status = 'active'` BEFORE it will construct a service client, which
 * is exactly the state this action is trying to reach. So the invited→active
 * flip is unavoidably a service-role write.
 *
 * This action mirrors the guard ordering of `guardedAdminClient` and adds two
 * tighter constraints, keeping the elevated write minimal and safe:
 *   1. validated identity via `getUser()`;
 *   2. AAL2 on the just-issued token (the caller genuinely completed TOTP);
 *   3. a verified TOTP factor actually exists (defence-in-depth beyond the claim);
 *   4. the write is hard-scoped to `auth.uid()`'s OWN row and ONLY flips
 *      `invited → active` — a `deactivated` account can never self-reactivate here.
 *
 * See follow-ups: the durable home for this is a sanctioned
 * `activateOwnProfileAfterEnrollment()` helper in `@/lib/supabase/admin`.
 *
 * NOTE: a `"use server"` module may only export async functions, so the result
 * shape is a local type — callers get it via the returned promise's inference.
 */
type ActivateResult = { ok: true } | { ok: false; error: string };

export async function activateProfileAfterEnrollment(): Promise<ActivateResult> {
  const supabase = await createServerSupabase();
  // The caller's profile is still `invited`, so there is no loaded profile to
  // read a language from — the locale comes from the cookie the login/accept
  // screens wrote.
  const d = await getDict();

  // 1. Identity — validated against the Auth server, not read from a cookie.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (userError || !user) {
    return { ok: false, error: d.authFlow.errors.unauthenticated };
  }

  // 2. Assurance — the caller must have reached AAL2 in this session.
  const claims = await getSessionClaims(supabase);
  if (!isAal2FromClaims(claims)) {
    return { ok: false, error: d.authFlow.errors.aal2_required };
  }

  // 3. Defence-in-depth: a verified TOTP factor must really exist.
  const factors = await listTotpFactors(supabase);
  if (!factors.some((factor) => factor.status === "verified")) {
    return { ok: false, error: d.authFlow.activate.noVerifiedFactor };
  }

  // 4. Elevated, self-scoped write. Never accepts a target id from the caller.
  const admin = createServiceRoleClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, status, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, error: profileError.message };
  }
  if (!profile) {
    return { ok: false, error: d.authFlow.errors.profile_missing };
  }
  if (profile.status === "active") {
    return { ok: true }; // Idempotent: a double-submit is not an error.
  }
  if (profile.status !== "invited") {
    // e.g. 'deactivated' — must not be self-reactivated through this path.
    return { ok: false, error: d.authFlow.activate.cannotActivate };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ status: "active" })
    .eq("id", user.id)
    .eq("status", "invited");
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  // Mark the matching pending invitation accepted (best-effort; may already be
  // consumed). `email` is citext, so the match is case-insensitive at the DB.
  await admin
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("email", profile.email)
    .eq("status", "pending");

  // Audit — actor is stamped from the session (the user themselves, at AAL2).
  await writeAudit({
    action: "auth.mfa_enrolled",
    entityType: "profile",
    entityId: user.id,
    metadata: { role: profile.role },
  });

  return { ok: true };
}
