/**
 * Invite a second Super Admin from the command line.
 *
 *   npx tsx scripts/invite-super-admin.ts <email>
 *
 * This mirrors `inviteUser` in src/app/(app)/admin/invitations/actions.ts step
 * for step — invitation row first, Auth invite second, compensating delete if
 * the email fails, then the `user.invite` audit row — rather than inventing a
 * second way to create an account. The only thing it does differently is skip
 * `guardedAdminClient`, which needs a browser session; the role gate it applies
 * is asserted here instead by requiring an existing active super_admin as the
 * inviter, and that id is what lands in `invitations.invited_by`.
 *
 * Possible only since migration 017 removed the `one_super_admin` index. The
 * controls that replaced it still apply: the invitee arrives through the staged
 * flow, must set a password, and must enrol TOTP before reaching any data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

{
  const envFile = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://freedom-studio-delta.vercel.app";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: npx tsx scripts/invite-super-admin.ts <email>");
  process.exit(1);
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  type DB = import("../src/lib/database.types.js").Database;
  const admin = createClient<DB>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The inviter must be a real, active super_admin — the same gate the server
  // action gets from guardedAdminClient(["super_admin"]).
  const { data: inviter } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "super_admin")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!inviter) throw new Error("no active super_admin to attribute the invitation to");

  const { data: existing } = await admin
    .from("profiles")
    .select("email, role, status")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    console.log(`Already has an account: ${email} — ${existing.role}/${existing.status}`);
    return;
  }

  const { data: invitation, error: insertError } = await admin
    .from("invitations")
    .insert({ email, role: "super_admin", invited_by: inviter.id })
    .select("id")
    .single();
  if (insertError || !invitation) {
    throw new Error(
      insertError?.code === "23505"
        ? `A live invitation for ${email} already exists.`
        : `Could not record the invitation: ${insertError?.message}`,
    );
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${APP_URL}/auth/accept`,
  });
  if (inviteError) {
    // Never leave an un-emailed intent behind.
    await admin.from("invitations").delete().eq("id", invitation.id);
    throw new Error(`Auth invite failed: ${inviteError.message}`);
  }

  await admin.from("audit_log").insert({
    action: "user.invite",
    entity_type: "invitation",
    entity_id: invitation.id,
    actor_id: inviter.id,
    actor_role: "super_admin",
    metadata: { email, role: "super_admin", via: "invite-super-admin script" },
  });

  console.log(`Invited ${email} as super_admin (invited_by ${inviter.email}).`);
  console.log(`Invitation id: ${invitation.id}`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
