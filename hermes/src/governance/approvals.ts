import { createHash } from "node:crypto";

import type { Json } from "@studio/lib/database.types.js";
import { alertOwner } from "../lib/owner.js";
import { hermesDict, DEFAULT_LOCALE, type Locale } from "../lib/i18n.js";
import { getPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { EXECUTABLE_ACTIONS, resolvePolicy, roleSatisfies } from "./policy.js";

export { EXECUTABLE_ACTIONS };

/**
 * Propose → (human decides) → execute.
 *
 * The agent may call `enqueueApproval`. It may call `executeApproval`. It can
 * never move a row between those two states — that transition is the DB guard
 * trigger's job, reachable only through `decide_approval`.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60_000;

export interface EnqueueArgs {
  actionType: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  jobName?: string;
  runId?: string;
  riskReason?: string;
  idempotencyKey?: string;
  /** Telegram chat the proposing conversation ran in (032) — scopes supersede. */
  sourceChatId?: string;
  /** Entity identity (`${actionType}:${entityId}`) — supersede matches ONLY
   * on this, never on action_type, so two distinct entities never collide.
   * Omitted for pure creates, which carry no stable entity id. */
  supersedeKey?: string;
}

export interface EnqueueResult {
  id: string;
  /** True when an identical proposal was already pending — the caller must
   * NOT send a second card; the first one is still live above. */
  deduped: boolean;
  /** Older same-action pendings from the same chat that were cancelled in
   * favour of this one, with the card each was announced on. */
  superseded: { id: string; cardMessageId: string | null }[];
}

function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/**
 * Queue a proposal. `required_role` is read from the policy table and NEVER
 * from the caller's arguments — that is the defence against a prompt-injected
 * tool call nominating itself an easier approver.
 */
export async function enqueueApproval(args: EnqueueArgs): Promise<EnqueueResult> {
  const policy = resolvePolicy(args.actionType);
  if (policy.tier === "automatic") {
    throw new Error(`${args.actionType} is automatic-tier; it must not be queued for approval`);
  }
  if (policy.tier === "human_only") {
    throw new Error(`${args.actionType} is human_only; the agent may not propose it`);
  }

  const db = getAdminClient();
  const idem =
    args.idempotencyKey ?? `${args.actionType}:${payloadHash(args.payload)}`;

  // SUPERSEDE (032, the S8 fix): a newer proposal for the SAME ENTITY retires
  // an older pending one for that entity, instead of stacking a second live
  // Approve button. The incident this closes: a turn failed after its card was
  // sent, Alina rephrased, and the re-resolved proposal for the same payout /
  // document / record produced a second card — two live buttons for one thing.
  //
  // KEYED ON ENTITY IDENTITY, never on action_type alone. An adversarial
  // review caught the earlier version: scoping to `action_type + chat` made
  // "mark Alice's payout paid" cancel a still-pending "mark Bob's payout paid"
  // in the same chat — a DIFFERENT payout, silently dropped, no settlement, no
  // error. `supersedeKey` is `${actionType}:${entityId}`, so two distinct
  // payouts never collide, and mark-paid never supersedes a cancel of the same
  // payout (different action, different intent). Pure creates carry no entity
  // id and therefore no key — they never supersede; the exact-payload dedupe
  // below plus the failure notice cover them.
  //
  // Legal without touching decide_approval: the 015 guard reserves only the
  // approved/rejected transitions; the sweep sets `cancelled` directly, the
  // same way the expiry sweep does.
  let superseded: { id: string; cardMessageId: string | null }[] = [];
  if (args.sourceChatId && args.supersedeKey) {
    const { data: stale } = await db
      .from("hermes_approvals")
      .select("id, card_message_id")
      .eq("state", "pending")
      .eq("source_chat_id", args.sourceChatId)
      .eq("supersede_key", args.supersedeKey)
      .neq("idempotency_key", idem);
    if (stale?.length) {
      const ids = stale.map((r) => r.id);
      const { error: cancelError } = await db
        .from("hermes_approvals")
        .update({ state: "cancelled", decision_note: `superseded by ${idem}` })
        .in("id", ids)
        .eq("state", "pending");
      if (!cancelError) {
        superseded = stale.map((r) => ({
          id: r.id,
          cardMessageId: (r.card_message_id as string | null) ?? null,
        }));
      }
    }
  }

  const ttlHours = (await getPolicyValue<number>("approval_ttl_hours")) ?? 72;
  const expiresAt =
    ttlHours > 0 ? new Date(Date.now() + ttlHours * 3_600_000).toISOString() : null;

  const { data, error } = await db
    .from("hermes_approvals")
    .insert({
      action_type: args.actionType,
      tier: policy.tier,
      required_role: policy.requiredRole ?? "super_admin",
      payload: args.payload as Json,
      preview: args.preview as Json,
      risk_reason: args.riskReason,
      job_name: args.jobName,
      run_id: args.runId,
      idempotency_key: idem,
      expires_at: expiresAt,
      source_chat_id: args.sourceChatId,
      supersede_key: args.supersedeKey,
    })
    .select("id")
    .single();

  if (error) {
    // 23505: an identical proposal already exists. If it is still pending this
    // is true deduplication — and the caller must know, because sending a
    // SECOND card for the same approval id was exactly how a retried
    // instruction confused the person reading the chat. If it reached a
    // terminal state the caller means a genuinely new request, so re-insert
    // under a disambiguated key.
    if (error.code === "23505") {
      const { data: existing } = await db
        .from("hermes_approvals")
        .select("id, state")
        .eq("idempotency_key", idem)
        .maybeSingle();
      if (existing?.state === "pending") {
        return { id: existing.id as string, deduped: true, superseded };
      }
      return enqueueApproval({ ...args, idempotencyKey: `${idem}:${Date.now()}` });
    }
    throw new Error(`enqueueApproval: ${error.message}`);
  }

  return { id: data!.id as string, deduped: false, superseded };
}

/** Best-effort: remember which Telegram message announces this approval. */
export async function recordCardMessage(approvalId: string, messageId: string): Promise<void> {
  await getAdminClient()
    .from("hermes_approvals")
    .update({ card_message_id: messageId })
    .eq("id", approvalId)
    .then(() => undefined, () => undefined);
}

/** Merge a step marker into execution_result and persist immediately. */
async function saveProgress(
  id: string,
  prev: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...prev, ...patch };
  await getAdminClient()
    .from("hermes_approvals")
    .update({ execution_result: next as Json })
    .eq("id", id);
  return next;
}

export async function executeApproval(
  approvalId: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ ok: boolean; message: string }> {
  const db = getAdminClient();
  // The result is reported back to the human who approved, so it is written in
  // THEIR language; the audit/alert text stays in one language for whoever
  // debugs the worker.
  const h = hermesDict(locale);

  // 1. Atomic claim. This single conditional UPDATE is the mutex: only the
  //    caller that flips executed_at from NULL gets a row back. The guard
  //    trigger blocks `state`, not `executed_at`, which is what makes this legal.
  const { data: claimed } = await db
    .from("hermes_approvals")
    .update({ executed_at: new Date().toISOString() })
    .eq("id", approvalId)
    .eq("state", "approved")
    .is("executed_at", null)
    .select("*")
    .maybeSingle();

  if (!claimed) {
    const { data: row } = await db
      .from("hermes_approvals")
      .select("state, executed_at")
      .eq("id", approvalId)
      .maybeSingle();
    if (!row) return { ok: false, message: h.approvalNotFound };
    if (row.executed_at) return { ok: true, message: h.approvalAlreadyExecuted };
    return { ok: false, message: h.approvalNotApproved(String(row.state)) };
  }

  // 2. Re-check the decider's CURRENT role. decide_approval checked it at
  //    decision time; a role can change between decision and execution.
  //
  //    A row in 'approved' with no decided_by cannot be produced by
  //    decide_approval, so if we ever see one, something wrote state by another
  //    path. Refuse rather than guess at an actor to attribute writes to.
  const decidedBy = claimed.decided_by;
  if (!decidedBy) {
    await db
      .from("hermes_approvals")
      .update({ state: "failed", executed_at: null, last_error: "approved with no decided_by" })
      .eq("id", approvalId);
    await alertOwner(`Approval ${approvalId} is approved but has no decider — refusing to execute.`);
    return { ok: false, message: h.approvalNoDecider };
  }

  const { data: decider } = await db
    .from("profiles")
    .select("role, status")
    .eq("id", decidedBy)
    .maybeSingle();

  if (
    !decider ||
    decider.status !== "active" ||
    !roleSatisfies(decider.role as string, claimed.required_role as string)
  ) {
    await db
      .from("hermes_approvals")
      .update({ state: "failed", executed_at: null, last_error: "approver no longer authorised" })
      .eq("id", approvalId);
    await alertOwner(`Approval ${approvalId} blocked: approver no longer authorised`);
    return { ok: false, message: h.approverNotAuthorised };
  }

  // 3. Refuse unwired actions BEFORE running anything.
  if (!EXECUTABLE_ACTIONS.has(claimed.action_type as string)) {
    await db
      .from("hermes_approvals")
      .update({ state: "failed", executed_at: null, last_error: "no executor" })
      .eq("id", approvalId);
    await alertOwner(`Approval ${approvalId}: no executor for ${claimed.action_type}`);
    return { ok: false, message: h.approvalNoExecutor(String(claimed.action_type)) };
  }

  try {
    const { runExecutor } = await import("./executors.js");
    const result = await runExecutor(
      claimed.action_type,
      (claimed.payload ?? {}) as Record<string, unknown>,
      decidedBy,
      (claimed.execution_result ?? {}) as Record<string, unknown>,
      (patch) =>
        saveProgress(approvalId, (claimed.execution_result ?? {}) as Record<string, unknown>, patch),
      locale,
    );

    await db
      .from("hermes_approvals")
      .update({
        state: "executed",
        execution_result: result.result as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", approvalId);

    return { ok: true, message: result.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = ((claimed.attempt_count as number) ?? 0) + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await db
        .from("hermes_approvals")
        .update({ state: "failed", executed_at: null, attempt_count: attempts, last_error: message })
        .eq("id", approvalId);
      await alertOwner(`Approval ${approvalId} failed permanently: ${message}`);
      return { ok: false, message: h.approvalFailedPermanently(attempts, message) };
    }

    // Release the claim so the sweep retries it later.
    await db
      .from("hermes_approvals")
      .update({
        executed_at: null,
        attempt_count: attempts,
        last_error: message,
        next_attempt_at: new Date(
          Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS),
        ).toISOString(),
      })
      .eq("id", approvalId);

    return { ok: false, message: h.approvalAttemptFailed(attempts, message) };
  }
}
