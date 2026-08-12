import { headers } from "next/headers";

import { decodeJwtPayload } from "@/lib/auth/claims";
import type { Database, Json } from "@/lib/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  createServiceRoleClient,
  hasServiceRoleKey,
} from "@/lib/supabase/service-internal";

/**
 * Append-only audit trail writer (docs/04-database-erd.md §4.16).
 *
 * `audit_log` has no INSERT policy for any application role — rows are written
 * by triggers and by service-role server paths only, and no role (including the
 * Super Admin, in-app) can update or delete them. This module is that server path.
 *
 * Actor identity is stamped from the CURRENT session, never from caller input,
 * so a call site cannot forge who did what.
 */

export type Role = Database["public"]["Enums"]["user_role"];

/**
 * Dotted-verb action names (docs/05 §9, docs/04 §4.16). The union is open
 * (`| (string & {})`) so feature agents can add new verbs without editing this
 * file, while still getting autocomplete for the canonical ones.
 */
export type AuditAction =
  | "user.invite"
  | "user.deactivate"
  | "user.reactivate"
  | "user.role_change"
  | "auth.mfa_enrolled"
  | "auth.mfa_reset"
  | "document.upload"
  | "document.download"
  | "document.delete"
  | "share.create"
  | "share.revoke"
  | "share.view"
  | "library.upload"
  | "library.download"
  | "library.delete"
  | "library.ai_review"
  | "payout.create"
  | "payout.approve"
  | "payout.paid"
  | "payout.cancel"
  | "ledger.post"
  | "scheme.update"
  | "forecast.snapshot"
  | "ai.model_switch"
  | "ai.settings_update"
  | "ai.reindex"
  | "ai.report_create"
  | "ai.classify"
  | "ai.analyse"
  | "settings.update"
  | (string & {});

export type WriteAuditInput = {
  action: AuditAction;
  entityType?: string | null;
  /** Text, not uuid — some audited entities have bigint keys. */
  entityId?: string | number | null;
  metadata?: Record<string, unknown> | null;
  /**
   * Explicit actor override. Only for system paths that have no session
   * (bootstrap, scheduled jobs). Leave unset for anything user-initiated.
   */
  actor?: { id: string | null; role: Role | null } | null;
};

export type WriteAuditResult = { ok: true } | { ok: false; error: string };

/**
 * Writes one audit row.
 *
 * Never throws: an audit failure must not roll back or mask the business action
 * the caller just performed. Inspect the returned `ok` flag when the call site
 * needs to react (and always check it for security-critical verbs).
 *
 * ```ts
 * await writeAudit({
 *   action: "payout.approve",
 *   entityType: "payout",
 *   entityId: payout.id,
 *   metadata: { net_amount: payout.net_amount, currency: payout.currency },
 * });
 * ```
 */
export async function writeAudit(input: WriteAuditInput): Promise<WriteAuditResult> {
  try {
    if (typeof window !== "undefined") {
      return { ok: false, error: "writeAudit is server-only." };
    }
    if (!hasServiceRoleKey()) {
      return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." };
    }

    const actor = input.actor === undefined ? await resolveActor() : input.actor;
    const request = await readRequestContext();

    const admin = createServiceRoleClient();
    const { error } = await admin.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId === null || input.entityId === undefined
        ? null
        : String(input.entityId),
      metadata: (input.metadata ?? {}) as Json,
      ip: request.ip,
      user_agent: request.userAgent,
    });

    if (error) {
      console.error("[audit] insert failed", { action: input.action, error: error.message });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[audit] write threw", { action: input.action, error: message });
    return { ok: false, error: message };
  }
}

/**
 * System/bootstrap variant: writes with `actor_id = null` (docs/04 §4.16 allows
 * NULL for anonymous or system actions). Use for scheduled jobs and the
 * bootstrap-admin path, never to hide a real user's action.
 */
export async function writeSystemAudit(
  input: Omit<WriteAuditInput, "actor">,
): Promise<WriteAuditResult> {
  return writeAudit({ ...input, actor: { id: null, role: null } });
}

/** Resolves the acting user from the current session; `null` when anonymous. */
async function resolveActor(): Promise<{ id: string | null; role: Role | null } | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user ?? null;
    if (error || !user) return null;

    // Prefer the profiles row (authoritative); fall back to the JWT role claim.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) return { id: user.id, role: profile.role };

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const claims = token ? decodeJwtPayload(token) : null;
    return { id: user.id, role: claims?.user_role ?? null };
  } catch {
    return null;
  }
}

/** Best-effort request metadata. Returns nulls outside a request scope. */
async function readRequestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ip =
      (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
      headerList.get("x-real-ip") ||
      null;
    return { ip, userAgent: headerList.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}
