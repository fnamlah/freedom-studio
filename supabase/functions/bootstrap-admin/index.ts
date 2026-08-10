// =============================================================================
// bootstrap-admin — Freedom Studio Edge Function (Deno)
// -----------------------------------------------------------------------------
// Solves the chicken-and-egg of an invite-only system (docs/05-auth-2fa.md §3):
// only the Super Admin can invite users, and at provisioning time there is no
// Super Admin to do the inviting. This function creates exactly that one
// invitation — once — and then must be tombstoned.
//
// It is deployed with `verify_jwt = false` because no session can exist yet, so
// its ONLY gate is a shared secret in the Authorization header. That makes the
// discipline around it part of the design, not an afterthought:
//
//   • BOOTSTRAP_TOKEN is a high-entropy secret set immediately before use and
//     deleted immediately after. Unset ⇒ the function answers 404 to everything.
//   • The token is compared in constant time, over digests, so neither the
//     comparison nor its duration reveals a prefix.
//   • Every rejection — bad method, wrong/absent token, disabled function — is
//     the SAME 404. An unauthenticated caller cannot even confirm the function
//     exists (the same no-oracle posture as share-view, docs/06 §5.4).
//   • It refuses with 409 once ANY super_admin profile exists, so re-running it
//     can never mint a second privileged invitation. The database enforces the
//     same rule independently via the `one_super_admin` unique index
//     (docs/03 §2.2) — this check is the friendly layer, not the authority.
//   • After a successful run, redeploy `tombstone.ts` over this entrypoint
//     (docs/10-deployment-operations.md provisioning checklist).
//
// invitations.invited_by is NULL here — the documented "system bootstrap"
// marker, and the reason that column is nullable at all
// (002_tables_core.sql / docs/04 §4.17).
// =============================================================================

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** The one gate. Unset means the function is disabled and 404s everything. */
const BOOTSTRAP_TOKEN = Deno.env.get("BOOTSTRAP_TOKEN") ?? "";

/** Address that receives the first Super Admin invitation. */
const BOOTSTRAP_ADMIN_EMAIL = Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ??
  "faisal@falconmind.co";

/** Absolute app origin; the invite link must land on the controlled accept route. */
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ??
  Deno.env.get("BOOTSTRAP_APP_BASE_URL") ??
  "";

/** Invitation lifetime, matching the `invitations.expires_at` default. */
const INVITATION_TTL_DAYS = 7;

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The uniform rejection: identical for disabled, wrong method, and bad token. */
function notFound(): Response {
  return json(404, { error: "not_found" });
}

// -----------------------------------------------------------------------------
// Constant-time bearer check
// -----------------------------------------------------------------------------

/**
 * Compares the presented bearer token to `BOOTSTRAP_TOKEN` without leaking
 * length or content through timing.
 *
 * Both sides are hashed first, so the byte-wise comparison always runs over two
 * fixed-length 32-byte digests: an attacker measuring response time learns
 * nothing about how many leading characters were correct, and the length of the
 * real secret is not observable either.
 */
async function bearerMatches(request: Request): Promise<boolean> {
  if (!BOOTSTRAP_TOKEN) return false;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  const presented = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1])),
  );
  const expected = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BOOTSTRAP_TOKEN)),
  );

  let difference = presented.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    difference |= presented[i] ^ expected[i];
  }
  return difference === 0;
}

// -----------------------------------------------------------------------------
// Steps
// -----------------------------------------------------------------------------

/**
 * True when the system already has its Super Admin.
 *
 * Errors count as "yes". Refusing to bootstrap on an unreadable database is the
 * safe direction: the cost is a retry, whereas guessing "no" risks a second
 * privileged invitation.
 */
async function superAdminExists(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .limit(1);

  if (error) {
    console.error("[bootstrap-admin] super_admin probe failed", error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

type InvitationRow = { id: string };

/**
 * Ensures a pending `super_admin` invitation exists for `email`.
 *
 * Returns the row plus whether this call created it — the caller needs that to
 * know whether a failed Auth invite should be compensated. A pre-existing
 * pending invitation (from an interrupted first attempt) is reused rather than
 * duplicated; the partial unique index `invitations_pending_email` would reject
 * a second one anyway.
 */
async function ensureInvitation(
  db: SupabaseClient,
  email: string,
): Promise<{ row: InvitationRow; created: boolean } | { error: string }> {
  const { data: existing, error: readError } = await db
    .from("invitations")
    .select("id, role")
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (readError) return { error: readError.message };

  if (existing) {
    if (existing.role !== "super_admin") {
      return { error: "a pending non-super_admin invitation already exists for this address" };
    }
    return { row: { id: existing.id }, created: false };
  }

  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: inserted, error: insertError } = await db
    .from("invitations")
    .insert({
      email,
      role: "super_admin",
      status: "pending",
      expires_at: expiresAt,
      invited_by: null, // system bootstrap — no profile exists to attribute this to
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { error: insertError?.message ?? "invitation insert returned no row" };
  }
  return { row: { id: inserted.id }, created: true };
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[bootstrap-admin] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return notFound();
  }

  // Method check first, but the response is the same 404 as an auth failure, so
  // the ordering reveals nothing.
  if (request.method !== "POST") return notFound();
  if (!(await bearerMatches(request))) return notFound();

  if (!APP_BASE_URL) {
    return json(500, {
      error: "misconfigured",
      detail: "APP_BASE_URL is not set; the invite link would have no destination.",
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (await superAdminExists(db)) {
    return json(409, {
      error: "already_bootstrapped",
      detail: "A super_admin profile already exists. Invite further users from the app.",
    });
  }

  const email = BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const invitation = await ensureInvitation(db, email);
  if ("error" in invitation) {
    console.error("[bootstrap-admin] invitation failed", invitation.error);
    return json(500, { error: "invitation_failed" });
  }

  // Auth invite second, exactly as docs/05 §3 specifies: the invitation row is
  // the authorization record, the Auth email is delivery. If delivery fails, the
  // row we created is removed so the system is left in its pre-call state.
  const redirectTo = `${APP_BASE_URL.replace(/\/+$/, "")}/auth/accept`;
  const { error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (inviteError) {
    console.error("[bootstrap-admin] inviteUserByEmail failed", inviteError.message);
    if (invitation.created) {
      await db.from("invitations").delete().eq("id", invitation.row.id);
    }
    return json(502, { error: "invite_send_failed" });
  }

  // Anonymous system action: actor_id NULL is the documented marker for a path
  // with no session behind it (docs/04 §4.16).
  const { error: auditError } = await db.from("audit_log").insert({
    actor_id: null,
    actor_role: null,
    action: "user.invite",
    entity_type: "invitations",
    entity_id: invitation.row.id,
    metadata: { bootstrap: true, role: "super_admin", email },
    ip: null,
    user_agent: request.headers.get("user-agent"),
  });
  if (auditError) console.error("[bootstrap-admin] audit insert failed", auditError.message);

  return json(200, { ok: true, email });
});
