/**
 * The autonomy policy table.
 *
 * This is the first of the three safety layers (the other two are the DB guard
 * trigger and the exactly-once execution claim). Its job is to make the
 * dangerous default impossible: an action nobody wrote down here resolves to
 * `approval`, never `automatic`, so a prompt-injected tool call cannot invent
 * an action that runs itself.
 */

export type AutonomyTier = "automatic" | "approval" | "human_only";

/** Only these roles may ever be named as an approver (see hermes_role_satisfies). */
export type ApproverRole = "super_admin" | "finance" | "manager";

export interface ActionPolicy {
  tier: AutonomyTier;
  requiredRole?: ApproverRole;
}

export const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // Money. Period close posts real ledger entries, so it needs the same roles
  // the underlying RPC demands.
  close_period: { tier: "approval", requiredRole: "finance" },

  // Creating a payout is the "maker" half of the existing maker-checker. Even
  // once approved here, the payout lands as `pending` and still needs a
  // super_admin to approve it in the app — Hermes can never be both halves.
  create_payout: { tier: "approval", requiredRole: "finance" },

  // Forecast snapshots are derived and reversible, but still write rows.
  snapshot_forecast: { tier: "approval", requiredRole: "finance" },

  // Read-only notifications need no approval.
  send_brief: { tier: "automatic" },
  send_compliance_alert: { tier: "automatic" },

  // Day-to-day records the bot may propose on request (029). All `approval`
  // tier by owner decision: every write shows a card first, so the row is
  // attributed to the person who tapped it and a misheard or injected
  // instruction cannot write on its own.
  record_earning: { tier: "approval", requiredRole: "manager" },
  record_session: { tier: "approval", requiredRole: "manager" },
  record_expense: { tier: "approval", requiredRole: "manager" },
  update_document: { tier: "approval", requiredRole: "manager" },
  upsert_model: { tier: "approval", requiredRole: "manager" },

  // Deletion is a write like any other here, with the same single tap — but
  // note what it can reach: `fn_agent_delete_record` whitelists earnings,
  // sessions and expenses only. `audit_log` and `ledger_entries` are refused
  // by the append-only triggers (013) for every role including the service
  // role, so no approval can remove financial history. A wrong ledger entry is
  // corrected with a reversing adjustment, which stays a deliberate human act.
  delete_record: { tier: "approval", requiredRole: "manager" },

  // Sending a compliance document's CONTENTS to the AI provider. Approval
  // tier because it is third parties' identity data (passports, IDs, dates of
  // birth) crossing to a semi-trusted processor: the tap IS the consent record
  // migration 014 requires, and it is what gets written to `ai_analysis_opt_in`.
  read_compliance_document: { tier: "approval", requiredRole: "manager" },

  // Things a human must do personally, with no agent-assisted path at all.
  approve_payout: { tier: "human_only", requiredRole: "super_admin" },
  mark_payout_paid: { tier: "human_only", requiredRole: "super_admin" },
  delete_document: { tier: "human_only", requiredRole: "super_admin" },
};

/**
 * Actions with a real executor in `executors.ts`.
 *
 * Kept here, in the dependency-free module, so the test that asserts every
 * entry is a declared non-automatic action can run without booting the
 * environment or a database client. An approved action with no executor must
 * fail loudly — a governance system that reports "done" when nothing ran is
 * worse than one that admits it cannot act.
 */
export const EXECUTABLE_ACTIONS: ReadonlySet<string> = new Set([
  "close_period",
  "snapshot_forecast",
  "create_payout",
  "record_earning",
  "record_session",
  "record_expense",
  "update_document",
  "upsert_model",
  "delete_record",
  "read_compliance_document",
]);

/** Unknown actions fail safe. This is the whole point of the function. */
export function resolvePolicy(actionType: string): ActionPolicy {
  return ACTION_POLICIES[actionType] ?? { tier: "approval", requiredRole: "super_admin" };
}

/**
 * Mirrors `public.hermes_role_satisfies` exactly. Deliberately NOT a rank:
 * manager and finance are peer domains in this system, and ordering them would
 * silently let one approve the other's actions.
 */
export function roleSatisfies(
  actorRole: string | null | undefined,
  requiredRole: string,
): boolean {
  if (!actorRole) return false;
  if (!["super_admin", "finance", "manager"].includes(requiredRole)) return false;
  return actorRole === requiredRole || actorRole === "super_admin";
}
