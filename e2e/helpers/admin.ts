import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireEnv } from "./env";
import type { E2ERole } from "./naming";

/**
 * Service-role access for the HARNESS ONLY — test-account seeding, link
 * generation, and cleanup. This is operator tooling (the same trust level as
 * the Supabase dashboard), not an app code path: the app's own service-role
 * usage stays behind `guardedAdminClient()` and is itself under test.
 *
 * Never used to shortcut a flow a spec is supposed to exercise, and never
 * pointed at `audit_log` / `ledger_entries` for writes (append-only).
 */
let cached: SupabaseClient | null = null;

export function serviceDb(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return cached;
}

/** Insert a pending invitation (idempotent: an existing pending row is reused). */
export async function insertInvitation(input: {
  email: string;
  role: E2ERole;
  modelId?: string;
  operatorId?: string;
}): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from("invitations").insert({
    email: input.email,
    role: input.role,
    model_id: input.modelId ?? null,
    operator_id: input.operatorId ?? null,
    invited_by: null, // system bootstrap marker, same as the staged SA invite
  });
  // 23505 = a pending invitation for this email already exists — fine, reuse it.
  if (error && error.code !== "23505") {
    throw new Error(`insertInvitation(${input.email}): ${error.message}`);
  }
}

/**
 * Create the auth user from the pending invitation WITHOUT sending email and
 * return the action link to drive in the browser. (`inviteUserByEmail` would
 * burn the project's ~2-4/hr built-in SMTP budget; generateLink sends nothing.)
 */
export async function generateInviteLink(email: string, redirectBase: string): Promise<string> {
  const db = serviceDb();
  const { data, error } = await db.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${redirectBase}/auth/accept` },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(`generateLink(${email}): ${error?.message ?? "no action_link"}`);
  }
  return data.properties.action_link;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = serviceDb();
  // Small instance: one page is plenty (5 e2e users + Faisal).
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Reset password + wipe TOTP factors so a stale test user can re-enroll cleanly. */
export async function resetUserForReseed(userId: string, password: string): Promise<void> {
  const db = serviceDb();
  const { data: factorData } = await db.auth.admin.mfa.listFactors({ userId });
  for (const factor of factorData?.factors ?? []) {
    await db.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
  }
  const { error } = await db.auth.admin.updateUserById(userId, { password });
  if (error) throw new Error(`updateUserById(${userId}): ${error.message}`);
}

export async function setProfileStatus(
  userId: string,
  status: "invited" | "active" | "deactivated",
): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from("profiles").update({ status }).eq("id", userId);
  if (error) throw new Error(`setProfileStatus(${userId}, ${status}): ${error.message}`);
}


/**
 * Pin a seeded account's UI language. The app renders post-login in
 * `profiles.locale`, whose default is Russian (019); the suite asserts on
 * English strings, so every fixture user is forced to English here — belt to
 * the `pinEnglish` cookie's braces, and the thing that makes the suite correct
 * on a fresh database rather than only where migration 019 already pinned them.
 */

/**
 * Pin a seeded account's role. seedRole asserts the role only for NEW users;
 * an existing fixture account can drift (e.g. a super_admin demoted during
 * unrelated work) and silently seed the wrong nav/capabilities. This makes the
 * fixture self-healing — since migration 017 lifted the single-super_admin
 * limit, restoring e2e-sa to super_admin no longer collides with the real one.
 */
export async function setProfileRole(userId: string, role: E2ERole): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from("profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(`setProfileRole(${userId}, ${role}): ${error.message}`);
}

export async function setProfileLocale(userId: string, locale: "en" | "ru"): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from("profiles").update({ locale }).eq("id", userId);
  if (error) throw new Error(`setProfileLocale(${userId}, ${locale}): ${error.message}`);
}

export async function getProfile(
  userId: string,
): Promise<{ id: string; role: string; status: string } | null> {
  const db = serviceDb();
  const { data, error } = await db
    .from("profiles")
    .select("id, role, status")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`getProfile(${userId}): ${error.message}`);
  return data;
}

/** Ensure the E2E model business row exists; returns its id. */
export async function ensureModelRow(createdBy: string): Promise<string> {
  const db = serviceDb();
  const stageName = "E2E-M1";
  const { data: existing } = await db
    .from("models")
    .select("id")
    .eq("stage_name", stageName)
    .maybeSingle();
  if (existing) {
    // A previous run's cleanup archives fixtures; re-runs revive them.
    await db.from("models").update({ status: "active" }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from("models")
    .insert({
      stage_name: stageName,
      legal_name: "E2E Test Model One (test fixture)",
      date_of_birth: "1995-01-01",
      commission_percent: 60,
      status: "active",
      created_by: createdBy,
      notes: "E2E test fixture — safe to archive",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureModelRow: ${error?.message}`);
  return data.id;
}

/**
 * Re-establish the business-row → login link.
 *
 * `profile_id` is what the model/operator self-read policies compare against
 * (`models.profile_id = auth.uid()`), and it is normally set once when an
 * invitation is accepted. A fixture row that was deleted and recreated — by a
 * cleanup, a wipe, or the manager UI in scenario 02 — comes back with a NULL
 * link, and every self-read assertion then reads zero rows for reasons that
 * look like an RLS regression. Re-linking on every seed makes the suite
 * self-healing instead of dependent on a row created many runs ago.
 */
export async function linkProfileToBusinessRow(
  table: "models" | "operators",
  rowId: string,
  profileId: string,
): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from(table).update({ profile_id: profileId }).eq("id", rowId);
  if (error) throw new Error(`linkProfileToBusinessRow(${table}, ${rowId}): ${error.message}`);
}

/** Ensure the E2E operator business row exists; returns its id. */
export async function ensureOperatorRow(createdBy: string): Promise<string> {
  const db = serviceDb();
  const displayName = "E2E-OP1";
  const { data: existing } = await db
    .from("operators")
    .select("id")
    .eq("display_name", displayName)
    .maybeSingle();
  if (existing) {
    await db.from("operators").update({ status: "active" }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from("operators")
    .insert({
      display_name: displayName,
      legal_name: "E2E Test Operator One (test fixture)",
      status: "active",
      created_by: createdBy,
      notes: "E2E test fixture — safe to archive",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`ensureOperatorRow: ${error?.message}`);
  return data.id;
}
