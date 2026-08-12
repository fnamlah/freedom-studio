"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { isRole, type Role } from "@/lib/auth/roles";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import { appBaseUrl } from "@/lib/env";
import type { Dictionary } from "@/lib/i18n";
import { getDict } from "@/lib/i18n/server";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";

/**
 * Super-Admin-only invitation management (docs/05 §3, Flow A).
 *
 * The invitation row and the Supabase Auth invite are created in the same
 * guarded server action; if the Auth call fails the invitation row is rolled
 * back (compensating delete) so an un-emailed intent is never left behind.
 */

export type InviteResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * A FACTORY, not a constant: a module-scope schema is built at import time,
 * before any request exists, so its messages could only ever be one language.
 * Called inside the action, once the reader's dictionary is known.
 */
const inviteSchema = (d: Dictionary) =>
  z
  .object({
    email: z.string().trim().toLowerCase().email(d.adminAi.invitations.errInvalidEmail),
    role: z.custom<Role>((value) => isRole(value), {
      message: d.adminAi.invitations.errInvalidRole,
    }),
    modelId: z.string().uuid().nullish(),
    operatorId: z.string().uuid().nullish(),
  })
  .transform((data) => ({
    email: data.email,
    role: data.role,
    // Pre-link is only meaningful for the matching role; drop anything else so
    // the `NOT (model_id IS NOT NULL AND operator_id IS NOT NULL)` CHECK holds.
    modelId: data.role === "model" ? data.modelId ?? null : null,
    operatorId: data.role === "operator" ? data.operatorId ?? null : null,
  }));

export async function inviteUser(input: {
  email: string;
  role: string;
  modelId?: string | null;
  operatorId?: string | null;
}): Promise<InviteResult> {
  const dictionary = await getDict();
  const d = dictionary.adminAi.invitations;

  const parsed = inviteSchema(dictionary).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? d.errInvalid };
  }
  const { email, role, modelId, operatorId } = parsed.data;

  try {
    const { admin, user } = await guardedAdminClient(["super_admin"]);

    // 1. Record the intent (docs/04 §4.17). Partial unique index rejects a second
    //    live invite for the same address.
    const { data: invitation, error: insertError } = await admin
      .from("invitations")
      .insert({
        email,
        role,
        model_id: modelId,
        operator_id: operatorId,
        invited_by: user.id,
      })
      .select("id")
      .single();

    if (insertError || !invitation) {
      const duplicate = insertError?.code === "23505";
      return { ok: false, error: duplicate ? d.errDuplicate : d.errCreateFailed };
    }

    // 2. Send the Auth invite. `handle_new_user` will consume the pending row at
    //    signup and pre-link the business record.
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appBaseUrl()}${AUTH_ROUTES.accept}`,
    });

    if (inviteError) {
      // Roll the intent back so it is never left un-emailed (docs/05 §3 note).
      await admin.from("invitations").delete().eq("id", invitation.id);
      const message = /already been registered|already exists/i.test(inviteError.message)
        ? d.errAccountExists
        : d.errSendFailed;
      return { ok: false, error: message };
    }

    // 3. Audit.
    await writeAudit({
      action: "user.invite",
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { email, role, model_id: modelId, operator_id: operatorId },
    });

    revalidatePath("/admin/invitations");
    return { ok: true, message: d.okSent(email) };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.errNotAuthorized };
    }
    return { ok: false, error: dictionary.common.unknownError };
  }
}
