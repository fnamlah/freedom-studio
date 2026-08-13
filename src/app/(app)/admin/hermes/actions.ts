"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";

/**
 * Hermes approvals — the human half of the agent's propose→approve→execute loop.
 *
 * Everything here goes through the `decide_approval` RPC, which is the ONLY path
 * that can move an approval into `approved`/`rejected`: a BEFORE UPDATE trigger
 * on `hermes_approvals` raises 42501 for any other writer, including the service
 * role the worker runs as (migration 015). So the agent can propose an action and
 * it can perform an approved one, but it can never authorise its own work.
 *
 * `decide_approval` is SECURITY DEFINER and resolves its actor as
 * `coalesce(auth.uid(), p_actor)` — auth.uid() always wins — so calling it from a
 * server action attributes the decision to the signed-in human and nobody else.
 * It re-checks that actor's role against the row's `required_role` in the
 * database; the `requireRole` below is UX, the RPC is the authority.
 *
 * Execution deliberately does NOT happen here. This request runs under the
 * approver's own RLS session and has no service-role client — per docs/11 the app
 * never holds one in a request path — so the decision is recorded and the Railway
 * worker's approval sweep performs it within seconds. That separation is the
 * point: the browser authorises, the worker acts.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * A factory rather than a module constant: a schema evaluated at import time
 * has no request and therefore no reader, so its messages could only be one
 * language. Called below, once `requireRole` has yielded the profile.
 */
const decideSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(d.adminAi.hermes.errInvalidApproval),
    verdict: z.enum(["approve", "reject"]),
    note: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().max(1000, d.adminAi.hermes.errNoteTooLong).nullable().optional(),
    ),
  });

export type DecideInput = {
  id: string;
  verdict: "approve" | "reject";
  note?: string | null;
};

/**
 * Map the RPC's own error codes to something a human can act on.
 *
 * The `default` branch deliberately still prefers the raw Postgres `message`:
 * an unmapped code is an unexpected condition, and the database's own words are
 * more useful to whoever has to diagnose it than a translated generic. The
 * translated fallback covers the case where there is no message at all.
 */
function describeDecisionError(
  code: string | undefined,
  message: string,
  d: Dictionary,
): string {
  const h = d.adminAi.hermes;
  switch (code) {
    case "42501":
      return h.errWrongRole;
    case "22023":
      return h.errAlreadyDecided;
    case "P0002":
      return h.errGone;
    default:
      return message || h.errFailed;
  }
}

export async function decideApproval(input: DecideInput): Promise<ActionResult> {
  // UX guard only. `decide_approval` re-verifies role in the database, and the
  // page itself is super-admin-only, but a proposal may require `finance` and
  // the RPC is what actually decides whether this caller satisfies it.
  const { supabase, profile } = await requireRole("super_admin");
  const dictionary = dict(toLocale(profile.locale));
  const d = dictionary.adminAi.hermes;

  const parsed = decideSchema(dictionary).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? d.errInvalidDecision };
  }

  const { error } = await supabase.rpc("decide_approval", {
    p_id: parsed.data.id,
    p_verdict: parsed.data.verdict,
    p_via: "portal",
    p_note: parsed.data.note ?? undefined,
  });

  if (error) {
    return { ok: false, error: describeDecisionError(error.code, error.message, dictionary) };
  }

  // The RPC writes the `hermes.approve` / `hermes.reject` audit row itself, as
  // the deciding user — no second write from here, so the trail has one entry
  // per decision rather than two that could disagree.
  revalidatePath("/admin/hermes");

  return {
    ok: true,
    message: parsed.data.verdict === "approve" ? d.okApproved : d.okRejected,
  };
}

/* ------------------------------------------------------------- pairing --- */

/**
 * Telegram pairing (migration 015).
 *
 * A person cannot simply message the bot: an unpaired chat may do exactly one
 * thing, redeem a one-time code. Until now those codes were minted by hand in
 * SQL, which meant the studio's second Super Admin had no way to pair at all —
 * the gap this closes.
 *
 * Two rules carried over from how the bot actually redeems a code
 * (`hermes/src/telegram/access.ts`, `telegram/handler.ts`), because minting a
 * code the bot will refuse is worse than refusing to mint one:
 *
 *   * Only `super_admin`, `manager` and `finance` may hold a channel. The bot
 *     answers from a service-role client that sees every row, so a channel for
 *     a model or operator would be a privilege escalation, not a convenience.
 *   * The code is PINNED to a Telegram username. A code was once pasted to an
 *     unrelated third-party bot and had to be burned; a pinned code is inert in
 *     anyone else's hands, and the bot stays silent on a mismatch rather than
 *     confirming the code is real.
 *
 * The raw code is returned to the minting Super Admin exactly once, to hand
 * over out of band. It is not secret in the password sense — it expires, it is
 * single-use, and it is useless without the pinned username — but it is not
 * shown again either.
 */

const TELEGRAM_USERNAME = /^@?[A-Za-z0-9_]{5,32}$/;

const pairSchema = (d: Dictionary) =>
  z.object({
    profile_id: z.string().uuid(d.adminAi.hermes.pairing.errChoosePerson),
    telegram_username: z
      .string()
      .trim()
      .regex(TELEGRAM_USERNAME, d.adminAi.hermes.pairing.errUsername),
    days: z.coerce
      .number()
      .int()
      .min(1, d.adminAi.hermes.pairing.errDays)
      .max(30, d.adminAi.hermes.pairing.errDays),
  });

export type MintPairingInput = {
  profile_id: string;
  telegram_username: string;
  days: number;
};

export type MintPairingResult =
  | { ok: true; code: string; username: string; expiresAt: string }
  | { ok: false; error: string };

export async function mintPairingCode(input: MintPairingInput): Promise<MintPairingResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const dictionary = dict(toLocale(profile.locale));
  const d = dictionary.adminAi.hermes.pairing;

  const parsed = pairSchema(dictionary).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? d.errFailed };
  }
  const username = parsed.data.telegram_username.replace(/^@/, "");

  // Re-read the target through the caller's own RLS. The bot enforces this
  // again at redemption; refusing here just means we never hand out a code
  // that cannot work.
  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("id, role, status, full_name, email")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();

  if (readError || !target) return { ok: false, error: d.errPersonGone };
  if (target.status !== "active") return { ok: false, error: d.errNotActive };
  if (!["super_admin", "manager", "finance"].includes(target.role)) {
    return { ok: false, error: d.errRoleNotEligible };
  }

  const code = randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();

  const { error } = await supabase.from("hermes_pairing_codes").insert({
    code,
    profile_id: target.id,
    expected_username: username,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: d.errFailed };

  // The CODE never enters the audit trail — a permanent record of a live
  // credential is exactly what an append-only log should not hold. Who minted
  // one, for whom, pinned to which handle, is what an auditor needs.
  await writeAudit({
    action: "hermes.pair",
    entityType: "profile",
    entityId: target.id,
    metadata: { op: "mint", telegram_username: username, expires_at: expiresAt },
  });

  revalidatePath("/admin/hermes");
  return { ok: true, code, username, expiresAt };
}

/**
 * Revoke a paired chat. Deactivates rather than deletes: the channel row is
 * how a past instruction is attributed, and the worker checks `is_active`
 * before it will answer anyone.
 */
export async function unpairChannel(input: { channel_id: string }): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin");
  const dictionary = dict(toLocale(profile.locale));
  const d = dictionary.adminAi.hermes.pairing;

  const parsed = z.object({ channel_id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: d.errFailed };

  const { data: updated, error } = await supabase
    .from("hermes_channels")
    .update({ is_active: false })
    .eq("id", parsed.data.channel_id)
    .eq("is_active", true)
    .select("id, profile_id, external_id")
    .maybeSingle();

  if (error) return { ok: false, error: d.errFailed };
  if (!updated) return { ok: false, error: d.errChannelGone };

  await writeAudit({
    action: "hermes.pair",
    entityType: "profile",
    entityId: updated.profile_id,
    metadata: { op: "unpair", channel_id: updated.id },
  });

  revalidatePath("/admin/hermes");
  return { ok: true, message: d.okUnpaired };
}
