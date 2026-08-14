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

  // Setting the studio up, rather than recording what it did (031). Same tier
  // and same role as the records above: a manager runs the studio day to day,
  // and every one of these still shows a card first.
  upsert_operator: { tier: "approval", requiredRole: "manager" },
  upsert_platform: { tier: "approval", requiredRole: "manager" },
  upsert_account: { tier: "approval", requiredRole: "manager" },
  upsert_assignment: { tier: "approval", requiredRole: "manager" },

  // Retiring someone or something — the gentle path, and the one the tool
  // descriptions steer toward. (It WAS the only path; see delete_entity.)
  set_status: { tier: "approval", requiredRole: "manager" },

  // Hard deletion of entities (032), by owner directive: "delete everything".
  // A SEPARATE action from delete_record so the manager's day-to-day surface
  // (earnings, sessions, expenses) is not silently widened — entity deletion
  // is super_admin only. What it can never reach, regardless of role:
  // ledger_entries and audit_log (013 refuses every role), paid payouts
  // (their settlement IS the ledger), the default scheme, and any payee with
  // posted history — the wrapper refuses those with a sentence naming counts
  // and offering archive. Every delete writes its own audit_log snapshot,
  // because no 007 trigger fires on DELETE.
  delete_entity: { tier: "approval", requiredRole: "super_admin" },

  // Cancelling a payout mirrors the portal's split: pending → cancellable by
  // manager (finance uses the portal — the peer-domain rule keeps it off this
  // policy's requiredRole), approved → the wrapper re-checks super_admin.
  cancel_payout: { tier: "approval", requiredRole: "manager" },

  // How the money is divided. SUPER ADMIN, not manager: schemes are SA-only in
  // 008, docs/09 §4.2 and docs/08. A manager may record what was earned; only
  // the owner decides who gets what share of it. `specsForRole` derives the
  // offered tool set from `requiredRole`, so a manager is never shown these.
  upsert_scheme: { tier: "approval", requiredRole: "super_admin" },
  set_rate_card: { tier: "approval", requiredRole: "super_admin" },

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

  // ⚠ Approving a payout USED TO BE `human_only`, and the comment above on
  // `create_payout` still describes the rule it belonged to: "Hermes can never
  // be both halves". The owner asked for approval from Telegram, explicitly
  // with no self-approval restriction, so this is now `approval` — and the
  // relaxation is stated rather than quietly applied.
  //
  // What is given up: a super_admin who created a payout can now also approve
  // it from their phone, without a second person and without opening the
  // portal. What is kept: `enforce_payout_transition` (007) still runs under
  // the approver's own claims, so its "only super_admin may approve" check is
  // live, and `approved_by` names the human.
  approve_payout: { tier: "approval", requiredRole: "super_admin" },

  // ⚠ The last two human_only entries fell with the owner's "EVERYTHING"
  // directive (032). Each is stated, not slipped:
  //
  // `mark_payout_paid` — settlement was a portal-side act; docs/03 §110's
  // origination/authorization/release split is now fully collapsible into one
  // super_admin on one phone, three taps apart. What is kept: only an APPROVED
  // payout can be marked paid (007's state machine, running under the
  // approver's claims), `payout_paid_settlement` remains the sole writer of
  // settlement ledger entries, and the entry is attributed to the human.
  //
  // `delete_document` — was human_only with no code path anywhere (the portal
  // has no document delete). Now real: the wrapper snapshots the row to
  // audit_log, and the executor removes the storage object.
  mark_payout_paid: { tier: "approval", requiredRole: "super_admin" },
  delete_document: { tier: "approval", requiredRole: "super_admin" },
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
  "upsert_operator",
  "upsert_platform",
  "upsert_account",
  "upsert_assignment",
  "set_status",
  "upsert_scheme",
  "set_rate_card",
  "approve_payout",
  "mark_payout_paid",
  "cancel_payout",
  "delete_document",
  "delete_entity",
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
