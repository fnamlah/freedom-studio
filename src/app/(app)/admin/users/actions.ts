"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import type { Dictionary } from "@/lib/i18n";
import { getDict } from "@/lib/i18n/server";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";

/**
 * Super-Admin-only user administration (docs/03 §3, docs/05 §8).
 *
 * Every action opens with `guardedAdminClient(["super_admin"])`, which — in this
 * same server invocation — validates the session, the AAL2 assurance claim, the
 * `active` profile status and the `super_admin` role BEFORE the service-role
 * credential is ever materialised (boxed invariant, docs/05 §7). Only then do we
 * flip status / delete factors, and every mutation writes an append-only
 * `audit_log` row via `writeAudit()`.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Zod schemas are module-scope constants evaluated at import, long before a
 * request exists, so they cannot read a locale. Making the schema a factory the
 * action calls once it HAS one is what lets the message be translated.
 */
const targetSchema = (d: Dictionary) =>
  z.object({ userId: z.string().uuid(d.adminAi.users.errInvalidUser) });

/**
 * Deactivates a user (session-assurance state machine, docs/05 §6):
 *   1. `profiles.status = 'deactivated'`, stamps `deactivated_at`.
 *   2. Revokes the user's sessions by deleting their verified MFA factors —
 *      deleting a verified factor logs the user out of all active sessions
 *      (Supabase Auth admin API). Even inside the revocation gap the RESTRICTIVE
 *      `is_active_profile()` policy already denies every query.
 *   3. Audits `user.deactivate`.
 *
 * The single Super Admin can never be deactivated (docs/03 §2.2 — exactly one
 * exists, and no in-app actor outranks them).
 */
export async function deactivateUser(input: { userId: string }): Promise<ActionResult> {
  // The locale before the guard: a refusal below still has to be readable, and
  // `getDict()` resolves from the session cookie/profile without elevating.
  const dictionary = await getDict();
  const d = dictionary.adminAi.users;

  const parsed = targetSchema(dictionary).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.errInvalidUser };
  }
  const { userId } = parsed.data;

  try {
    const { admin, user } = await guardedAdminClient(["super_admin"]);

    if (userId === user.id) {
      return { ok: false, error: d.errSelfDeactivate };
    }

    const { data: target, error: readError } = await admin
      .from("profiles")
      .select("id, role, status, full_name, email")
      .eq("id", userId)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.errLoadUser };
    }
    if (!target) {
      return { ok: false, error: d.errUserNotFound };
    }
    if (target.role === "super_admin") {
      return { ok: false, error: d.errSuperAdminProtected };
    }
    if (target.status === "deactivated") {
      return { ok: false, error: d.errAlreadyDeactivated };
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ status: "deactivated", deactivated_at: new Date().toISOString() })
      .eq("id", userId);

    if (updateError) {
      return { ok: false, error: d.errDeactivateFailed };
    }

    // Revoke sessions: delete every MFA factor (a verified factor deletion logs
    // the user out of all active sessions).
    const revokedFactors = await revokeSessionsByDeletingFactors(admin, userId);

    await writeAudit({
      action: "user.deactivate",
      entityType: "profile",
      entityId: userId,
      metadata: {
        email: target.email,
        role: target.role,
        full_name: target.full_name,
        factors_revoked: revokedFactors,
      },
    });

    revalidatePath("/admin/users");
    return { ok: true, message: d.okDeactivated(target.full_name) };
  } catch (error) {
    return { ok: false, error: describeError(error, dictionary) };
  }
}

/**
 * Resets a user's TOTP factor (lost-device runbook, docs/05 §8.1):
 * deletes their MFA factors and revokes their sessions, so the next login lands
 * at AAL1 with zero factors and the middleware forces re-enrollment. Audited as
 * `auth.mfa_reset`. Identity is verified out-of-band by the Super Admin before
 * this is ever triggered (runbook step 2).
 */
export async function resetUserMfa(input: { userId: string }): Promise<ActionResult> {
  const dictionary = await getDict();
  const d = dictionary.adminAi.users;

  const parsed = targetSchema(dictionary).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.errInvalidUser };
  }
  const { userId } = parsed.data;

  try {
    const { admin, user } = await guardedAdminClient(["super_admin"]);

    if (userId === user.id) {
      return { ok: false, error: d.errSelfMfaReset };
    }

    const { data: target, error: readError } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.errLoadUser };
    }
    if (!target) {
      return { ok: false, error: d.errUserNotFound };
    }

    const revokedFactors = await revokeSessionsByDeletingFactors(admin, userId);

    if (revokedFactors === 0) {
      return { ok: false, error: d.errNoFactor };
    }

    await writeAudit({
      action: "auth.mfa_reset",
      entityType: "profile",
      entityId: userId,
      metadata: {
        email: target.email,
        full_name: target.full_name,
        factors_revoked: revokedFactors,
      },
    });

    revalidatePath("/admin/users");
    return { ok: true, message: d.okMfaReset(target.full_name) };
  } catch (error) {
    return { ok: false, error: describeError(error, dictionary) };
  }
}

/**
 * Deletes every MFA factor on a user via the Auth admin API and returns how many
 * were removed. Deleting a verified factor revokes the user's active sessions.
 */
async function revokeSessionsByDeletingFactors(
  admin: Awaited<ReturnType<typeof guardedAdminClient>>["admin"],
  userId: string,
): Promise<number> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error || !data?.factors?.length) {
    return 0;
  }

  let deleted = 0;
  for (const factor of data.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (!deleteError) deleted += 1;
  }
  return deleted;
}

function describeError(error: unknown, d: Dictionary): string {
  if (isAuthzError(error)) {
    return d.adminAi.users.errNotAuthorized;
  }
  return d.common.unknownError;
}
