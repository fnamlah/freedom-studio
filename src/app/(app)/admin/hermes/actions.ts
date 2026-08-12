"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guard";

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

const decideSchema = z.object({
  id: z.string().uuid("Invalid approval."),
  verdict: z.enum(["approve", "reject"]),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(1000, "Keep the note under 1000 characters.").nullable().optional(),
  ),
});

export type DecideInput = {
  id: string;
  verdict: "approve" | "reject";
  note?: string | null;
};

/** Map the RPC's own error codes to something a human can act on. */
function describeDecisionError(code: string | undefined, message: string): string {
  switch (code) {
    case "42501":
      return "You're not authorised to decide this proposal. It requires a different role.";
    case "22023":
      return "That proposal has already been decided. Refresh to see its current state.";
    case "P0002":
      return "That proposal no longer exists.";
    default:
      return message || "The decision could not be recorded.";
  }
}

export async function decideApproval(input: DecideInput): Promise<ActionResult> {
  // UX guard only. `decide_approval` re-verifies role in the database, and the
  // page itself is super-admin-only, but a proposal may require `finance` and
  // the RPC is what actually decides whether this caller satisfies it.
  const { supabase } = await requireRole("super_admin");

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const { error } = await supabase.rpc("decide_approval", {
    p_id: parsed.data.id,
    p_verdict: parsed.data.verdict,
    p_via: "portal",
    p_note: parsed.data.note ?? undefined,
  });

  if (error) {
    return { ok: false, error: describeDecisionError(error.code, error.message) };
  }

  // The RPC writes the `hermes.approve` / `hermes.reject` audit row itself, as
  // the deciding user — no second write from here, so the trail has one entry
  // per decision rather than two that could disagree.
  revalidatePath("/admin/hermes");

  return {
    ok: true,
    message:
      parsed.data.verdict === "approve"
        ? "Approved. Hermes will carry it out within a few seconds."
        : "Rejected. Nothing will be executed.",
  };
}
