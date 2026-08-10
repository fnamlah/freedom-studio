"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { isRole, type Role } from "@/lib/auth/roles";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import { appBaseUrl } from "@/lib/env";
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

const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    role: z.custom<Role>((value) => isRole(value), { message: "Select a valid role." }),
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
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
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
      return {
        ok: false,
        error: duplicate
          ? "A pending invitation already exists for this email."
          : "Could not create the invitation. Please try again.",
      };
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
        ? "An account with this email already exists."
        : "Could not send the invite email. Please try again.";
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
    return { ok: true, message: `Invitation sent to ${email}.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to invite users." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
