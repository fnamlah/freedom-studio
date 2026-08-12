"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

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
