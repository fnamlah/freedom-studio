import assert from "node:assert/strict";
import test from "node:test";

// Deliberately RELATIVE, not "@studio/...". tsc does not rewrite path aliases
// at emit, so an aliased *value* import compiles fine and then fails at runtime
// in the container. Because `rootDir` is the repo root, the relative path
// resolves identically in src/ and in dist/. This import is also the security
// property being asserted: the worker uses the app's real chokepoint object.
import {
  BLOCKED_KEYS,
  PROJECTIONS,
  PROJECTION_UNBLOCK,
  redactToolResult,
  scrubText,
} from "../../../src/lib/ai/redactor.js";
import {
  ACTION_POLICIES,
  EXECUTABLE_ACTIONS,
  resolvePolicy,
  roleSatisfies,
} from "./policy.js";
import { BOT_ROLES, commandAllowed, roleMayUseBot } from "../telegram/access.js";
import {
  PROPOSE_ACTION,
  projectionFor,
  specsForRole,
  SUPERSEDE_ID_FIELD,
  supersedeKeyFor,
  TOOL_COMMAND,
  TOOL_SPECS,
  TOOL_PROJECTION,
} from "../llm/tool-catalog.js";
import { isIdleExpired, parseState, toMessages, withinBudget } from "../llm/history.js";
import { hermesEn, hermesRu } from "../lib/i18n.js";

test("unknown actions fail safe to approval, never automatic", () => {
  for (const unknown of ["", "wire_funds", "drop_table", "../../etc/passwd", "SEND_BRIEF"]) {
    const p = resolvePolicy(unknown);
    assert.equal(p.tier, "approval", `${unknown} must require approval`);
    assert.equal(p.requiredRole, "super_admin");
  }
});

test("no action is automatic unless it is read-only by construction", () => {
  const automatic = Object.entries(ACTION_POLICIES)
    .filter(([, p]) => p.tier === "automatic")
    .map(([k]) => k);
  // Only notification actions may run unattended. If this list grows, that is a
  // governance decision and this test is where it must be argued.
  assert.deepEqual(automatic.sort(), ["send_brief", "send_compliance_alert"]);
});

test("every executable action is declared and requires a human", () => {
  for (const action of EXECUTABLE_ACTIONS) {
    const policy = ACTION_POLICIES[action];
    assert.ok(policy, `${action} has an executor but no policy entry`);
    assert.notEqual(policy.tier, "automatic", `${action} must not execute unattended`);
    assert.ok(policy.requiredRole, `${action} must name an approver role`);
  }
});

test("human_only actions have no executor", () => {
  for (const [action, policy] of Object.entries(ACTION_POLICIES)) {
    if (policy.tier === "human_only") {
      assert.ok(!EXECUTABLE_ACTIONS.has(action), `${action} is human_only but has an executor`);
    }
  }
});

test("roleSatisfies mirrors the DB: exact match or super_admin, not a rank", () => {
  assert.ok(roleSatisfies("finance", "finance"));
  assert.ok(roleSatisfies("super_admin", "finance"));
  assert.ok(roleSatisfies("super_admin", "manager"));

  // Peer domains must NOT satisfy each other.
  assert.ok(!roleSatisfies("manager", "finance"));
  assert.ok(!roleSatisfies("finance", "manager"));

  // Roles with no approval authority at all.
  assert.ok(!roleSatisfies("model", "finance"));
  assert.ok(!roleSatisfies("operator", "manager"));
  assert.ok(!roleSatisfies(null, "finance"));
  assert.ok(!roleSatisfies(undefined, "super_admin"));

  // A required role outside the approver set is never satisfiable.
  assert.ok(!roleSatisfies("super_admin", "model"));
  assert.ok(!roleSatisfies("super_admin", "operator"));
});

test("the worker uses the app's real redaction chokepoint, not a copy", () => {
  // Identity, not deep-equality: a vendored copy would pass a value check and
  // then drift silently. These must be the very objects the app ships.
  assert.ok(typeof redactToolResult === "function");
  assert.ok(PROJECTIONS && typeof PROJECTIONS === "object");
  assert.ok(Array.isArray(BLOCKED_KEYS) || BLOCKED_KEYS instanceof Set);

  const blocked = Array.isArray(BLOCKED_KEYS) ? BLOCKED_KEYS : [...BLOCKED_KEYS];
  assert.equal(blocked.length, 17, "the documented 17-key blocklist changed size");
  for (const key of ["legal_name", "date_of_birth", "email", "phone"]) {
    assert.ok(blocked.includes(key), `${key} must stay on the blocklist`);
  }
});

test("a tool with no projection fails closed", () => {
  assert.throws(
    () => redactToolResult("hermes_tool_that_does_not_exist", { anything: 1 }),
    /projection|unregistered|unknown/i,
    "an unregistered tool must throw, not pass data through",
  );
});

test("models and operators can never hold a bot channel", () => {
  // The bot answers from a service-role client that sees every row; the app
  // shows these roles only their own. A channel would be privilege escalation.
  assert.ok(!BOT_ROLES.has("model"));
  assert.ok(!BOT_ROLES.has("operator"));
  assert.ok(!roleMayUseBot("model"));
  assert.ok(!roleMayUseBot("operator"));
  assert.ok(!roleMayUseBot(null));
  assert.ok(!roleMayUseBot(""));

  assert.deepEqual([...BOT_ROLES].sort(), ["finance", "manager", "super_admin"]);
});

test("the kill switch answers only to a super admin", () => {
  for (const cmd of ["/pause", "/resume"]) {
    assert.ok(commandAllowed("super_admin", cmd), `${cmd} must work for super_admin`);
    assert.ok(!commandAllowed("manager", cmd), `${cmd} must refuse manager`);
    assert.ok(!commandAllowed("finance", cmd), `${cmd} must refuse finance`);
  }
  // Ordinary commands stay open to every bot role, and closed to everyone else.
  for (const role of ["super_admin", "manager", "finance"]) {
    assert.ok(commandAllowed(role, "/brief"));
    assert.ok(commandAllowed(role, "/approvals"));
  }
  assert.ok(!commandAllowed("model", "/brief"));
  assert.ok(!commandAllowed("operator", "/status"));
});

test("scrubText masks contact details in free text", () => {
  const out = scrubText("reach me at jane.doe@example.com or +1 415 555 0199");
  assert.ok(!out.includes("jane.doe@example.com"), "email survived scrubbing");
  assert.ok(!out.includes("5550199"), "phone survived scrubbing");
});

/* --------------------------------------------------- conversational tools --- */

test("every conversational tool is registered in the redactor, fail-closed", () => {
  // The one property that keeps a new reader from reaching a provider by
  // being forgotten: if a tool exists here but not in PROJECTIONS, its rows
  // could never be serialized — better to fail this test than to find out in
  // production that the projection was the missing piece.
  // TOOL_PROJECTION is the single source for reuse (`hermes_balances` →
  // `payee_balances` etc.); every propose_* tool returns the shared ack.
  for (const tool of Object.keys(TOOL_COMMAND)) {
    const projected = PROPOSE_ACTION[tool] ? "hermes_proposal" : projectionFor(tool);
    assert.ok(
      PROJECTIONS[projected],
      `${tool} has no egress projection — it would throw at run time`,
    );
  }
  // And the reuse map itself may only name projections that exist.
  for (const [tool, projection] of Object.entries(TOOL_PROJECTION)) {
    assert.ok(PROJECTIONS[projection], `${tool} maps to unregistered projection ${projection}`);
  }
});

test("conversational tools carry no identity fields into a projection", () => {
  const blocked = Array.isArray(BLOCKED_KEYS) ? BLOCKED_KEYS : [...BLOCKED_KEYS];
  for (const tool of Object.keys(TOOL_COMMAND)) {
    const projected = PROPOSE_ACTION[tool] ? "hermes_proposal" : projectionFor(tool);
    const unblocked = PROJECTION_UNBLOCK[tool] ?? new Set<string>();
    for (const field of PROJECTIONS[projected] ?? []) {
      if (unblocked.has(field)) continue; // the one documented exception, below
      assert.ok(
        !blocked.includes(field),
        `${tool} projects "${field}", which is on the blocklist`,
      );
    }
  }
});

test("the identity unblock is exactly one tool with exactly the agreed fields", () => {
  // PROJECTION_UNBLOCK lets a tool emit blocklisted keys verbatim. It exists
  // for ONE tool, by owner decision, with ONE field set. Growing either — a
  // second tool, an extra key — is a governance decision, and this failing
  // test is where it gets argued, never a drive-by edit.
  assert.deepEqual(Object.keys(PROJECTION_UNBLOCK), ["hermes_person_details"]);
  assert.deepEqual(
    [...PROJECTION_UNBLOCK.hermes_person_details!].sort(),
    ["date_of_birth", "email", "legal_name", "payment_details", "phone"],
  );
  // And it is only reachable behind the SA/MGR gate — never finance.
  assert.equal(TOOL_COMMAND.hermes_person_details, "/documents");
});

test("a role is never offered a tool it may not run", () => {
  for (const role of ["super_admin", "manager", "finance"]) {
    const offered = specsForRole(role, commandAllowed).map((s) => s.function.name);
    for (const name of offered) {
      // The OFFER gate and the EXECUTION gate must agree, per tool class:
      // proposals are gated by who could DECIDE them (the policy role, the
      // same check decide_approval makes in the database); reads by the
      // mirrored slash command. runTool enforces exactly this split.
      const action = PROPOSE_ACTION[name];
      if (action) {
        const policy = resolvePolicy(action);
        assert.ok(
          policy.tier === "approval" && roleSatisfies(role, policy.requiredRole ?? "super_admin"),
          `${role} was offered ${name} but may not run it`,
        );
      } else {
        assert.ok(
          commandAllowed(role, TOOL_COMMAND[name]!),
          `${role} was offered ${name} but may not run it`,
        );
      }
    }
    // Every role that may hold a channel must get something to work with,
    // otherwise the conversation is decorative for them.
    assert.ok(offered.length > 0, `${role} was offered no tools at all`);
  }
});

test("no tool writes directly — every mutation is a proposal a human approves", () => {
  // The owner opened the bot up to creating, changing and deleting records
  // (029/030). "Read-only" is therefore no longer the invariant; THIS is:
  // anything that can change data goes through an approval card, and the
  // executor runs only after `decide_approval` re-checks the approver's role
  // in the database. A new mutating tool that skipped the proposal step would
  // fail here rather than ship.
  for (const tool of Object.keys(TOOL_COMMAND)) {
    const mutating = /create|update|delete|record|upsert|set_|write|propose/i.test(tool);
    if (!mutating) continue;
    assert.ok(
      PROPOSE_ACTION[tool],
      `${tool} looks like a mutation but is not a propose_* tool`,
    );
  }
});

test("every proposal maps to an approval-tier action with a real executor", () => {
  for (const [tool, action] of Object.entries(PROPOSE_ACTION)) {
    const policy = resolvePolicy(action);
    // `automatic` would let the model's own tool call execute itself, which is
    // the entire thing the governance layer exists to prevent.
    assert.equal(policy.tier, "approval", `${tool} -> ${action} must be approval tier`);
    assert.ok(policy.requiredRole, `${action} must name a required role`);
    assert.ok(
      EXECUTABLE_ACTIONS.has(action),
      `${action} has no executor — an approved proposal would report success and do nothing`,
    );
  }
});

test("a role is never offered a proposal it could not itself approve", () => {
  // Offering a finance user a card only a manager can decide is a dead end;
  // worse, it invites the model to promise something that cannot happen.
  for (const role of ["super_admin", "manager", "finance"]) {
    for (const spec of specsForRole(role, commandAllowed)) {
      const action = PROPOSE_ACTION[spec.function.name];
      if (!action) continue;
      assert.ok(
        roleSatisfies(role, resolvePolicy(action).requiredRole ?? "super_admin"),
        `${role} was offered ${spec.function.name} but could not approve it`,
      );
    }
  }
});

test("deleting cannot reach financial history", () => {
  // `fn_agent_delete_record` whitelists three kinds; audit_log and
  // ledger_entries are absent AND refused by the 013 triggers for every role.
  // This pins the tool-side half of that promise.
  const deleteSpec = TOOL_SPECS.find((s) => s.function.name === "hermes_propose_delete");
  assert.ok(deleteSpec, "the delete proposal tool is missing");
  const kinds = (deleteSpec!.function.parameters as {
    properties?: { kind?: { enum?: string[] } };
  }).properties?.kind?.enum;
  assert.deepEqual(kinds, ["earning", "work_session", "expense"]);
  for (const forbidden of ["ledger_entry", "audit_log"]) {
    assert.ok(!kinds?.includes(forbidden), `${forbidden} must not be deletable by the bot`);
  }

  // The ENTITY delete tool (032) is wider by owner directive — but pinned:
  // these eight kinds, nothing more, and never the financial history. Its
  // action is super_admin-only (asserted separately above).
  const entitySpec = TOOL_SPECS.find((s) => s.function.name === "hermes_propose_delete_entity");
  assert.ok(entitySpec, "the entity delete tool is missing");
  const entityKinds = (entitySpec!.function.parameters as {
    properties?: { kind?: { enum?: string[] } };
  }).properties?.kind?.enum;
  assert.deepEqual(entityKinds, [
    "model",
    "operator",
    "platform",
    "account",
    "assignment",
    "scheme",
    "rate_card",
    "payout",
  ]);
  for (const forbidden of ["ledger_entry", "audit_log", "profile", "user"]) {
    assert.ok(!entityKinds?.includes(forbidden), `${forbidden} must not be entity-deletable`);
  }
});

/* ------------------------------------------------------ conversation memory --- */

const turn = (i: number, at = new Date().toISOString()) => ({
  user: `q${i}`,
  assistant: `a${i}`,
  at,
});

test("a replayed history is only user and assistant prose — never a tool stub", () => {
  // The invariant the whole storage shape exists to hold. Re-feeding an
  // assistant message with tool_calls, or a tool message whose call is gone,
  // is a provider linkage error — the app has to filter its own log for this
  // reason; here it must be unrepresentable.
  const messages = toMessages([turn(1), turn(2)]);
  assert.equal(messages.length, 4);
  for (const m of messages) {
    assert.ok(m.role === "user" || m.role === "assistant", `unexpected role ${m.role}`);
    assert.equal("tool_calls" in m, false);
    assert.equal("tool_call_id" in m, false);
  }
});

test("state from a different role is discarded", () => {
  // Assistant prose contains aggregates the previous role was entitled to see.
  const state = { v: 1, role: "super_admin", turns: [turn(1)] };
  assert.deepEqual(parseState(state, "finance"), []);
  assert.equal(parseState(state, "super_admin").length, 1);
});

test("malformed or future state fails open to no memory, never throws", () => {
  for (const bad of [null, undefined, {}, [], "nope", 7, { v: 2, turns: [turn(1)] }]) {
    assert.deepEqual(parseState(bad, "super_admin"), [], `${JSON.stringify(bad)} should be empty`);
  }
  // Individually malformed turns are skipped, not fatal.
  const mixed = { v: 1, role: "x", turns: [turn(1), { user: "" }, { assistant: 3 }, turn(2)] };
  assert.equal(parseState(mixed, "x").length, 2);
});

test("an idle gap starts a new conversation", () => {
  const now = Date.parse("2026-08-13T12:00:00Z");
  const recent = new Date(now - 5 * 60_000).toISOString();
  const stale = new Date(now - 45 * 60_000).toISOString();
  assert.equal(isIdleExpired(recent, 30, now), false);
  assert.equal(isIdleExpired(stale, 30, now), true);
  // No prior message, or an unparseable one, is a fresh conversation.
  assert.equal(isIdleExpired(null, 30, now), true);
  assert.equal(isIdleExpired("not-a-date", 30, now), true);
});

test("the character budget drops WHOLE pairs, newest first", () => {
  const big = (i: number) => ({ user: "u".repeat(500), assistant: "a".repeat(500), at: `t${i}` });
  const kept = withinBudget([big(1), big(2), big(3), big(4)], 2200);
  // 1000 chars per pair → only two fit, and they must be the NEWEST two.
  assert.equal(kept.length, 2);
  assert.equal(kept[0]!.at, "t3");
  assert.equal(kept[1]!.at, "t4");
  // Never a half pair.
  for (const t of kept) assert.ok(t.user && t.assistant);
});

test("every conversational tool has a progress label in BOTH languages", () => {
  // A missing label is not fatal at run time (it falls back), but a tool with
  // no Russian label would show English to a Russian reader — the exact
  // failure the typed dictionary exists to prevent.
  for (const tool of Object.keys(TOOL_COMMAND)) {
    assert.ok(hermesEn.chatTool[tool], `${tool} has no English progress label`);
    assert.ok(hermesRu.chatTool[tool], `${tool} has no Russian progress label`);
  }
});

test("finance never reaches compliance documents through the bot", () => {
  // An adversarial review caught this as a live privilege escalation: all
  // three new read tools were gated by `/balances`, and `commandAllowed`
  // returns true for finance on any command not explicitly restricted — so
  // the bot served passport titles, types, expiry dates and the AI's extracts
  // of their contents to a role that 008 denies the `documents` table
  // ENTIRELY. Earnings and terms ARE fine for finance, which is what made
  // documents a silent outlier rather than an obvious one.
  assert.equal(commandAllowed("finance", "/documents"), false);
  assert.equal(commandAllowed("finance", "/propose"), false);
  assert.equal(commandAllowed("manager", "/documents"), true);
  assert.equal(commandAllowed("super_admin", "/documents"), true);

  const offered = specsForRole("finance", commandAllowed).map((s) => s.function.name);
  assert.ok(!offered.includes("hermes_documents"), "finance was offered the document reader");
  assert.ok(!offered.includes("hermes_person_details"), "finance was offered identity details");
  assert.ok(!offered.includes("hermes_expenses"), "finance has no 008 policy on expenses");
  // Finance IS offered proposals now — but ONLY those it could itself approve
  // (its own policy domain: payouts, period close, forecast). Everything else
  // stays out of reach.
  const financeProposals = offered.filter((n) => n.startsWith("hermes_propose")).sort();
  assert.deepEqual(financeProposals, [
    "hermes_propose_close_period",
    "hermes_propose_payout",
    "hermes_propose_snapshot_forecast",
  ]);
  // …and the reads finance legitimately holds are still there.
  assert.ok(offered.includes("hermes_model_earnings"));
});

test("the destructive surface is super_admin only", () => {
  for (const role of ["manager", "finance"]) {
    const offered = specsForRole(role, commandAllowed).map((s) => s.function.name);
    for (const tool of [
      "hermes_propose_mark_paid",
      "hermes_propose_delete_entity",
      "hermes_propose_delete_document",
      "hermes_propose_scheme",
      "hermes_propose_rate_card",
      "hermes_propose_approve_payout",
    ]) {
      assert.ok(!offered.includes(tool), `${role} was offered ${tool}`);
    }
  }
  const sa = specsForRole("super_admin", commandAllowed).map((s) => s.function.name);
  for (const tool of ["hermes_propose_mark_paid", "hermes_propose_delete_entity"]) {
    assert.ok(sa.includes(tool), `super_admin missing ${tool}`);
  }
});

test("no read tool inherits a gate wider than the surface it reads", () => {
  // The circular version of this test — asserting commandAllowed(role,
  // TOOL_COMMAND[name]) — passed unconditionally and caught nothing. This
  // pins the mapping itself.
  assert.equal(TOOL_COMMAND.hermes_documents, "/documents");
  for (const tool of Object.keys(PROPOSE_ACTION)) {
    assert.equal(TOOL_COMMAND[tool], "/propose", `${tool} must sit behind /propose`);
  }
});

test("the attachment upload is proposal-gated and its bytes move only post-tap", () => {
  // The properties that make a Telegram file safe to accept: the action is
  // approval-tier (a card, a human, a tap), manager-approvable like the
  // portal's own upload gate (008 documents_admin_all), and the tool spec
  // never asks the model for a file id — the id comes from the chat context,
  // so a prompt-injected call cannot name an arbitrary Telegram file.
  const policy = resolvePolicy("upload_document");
  assert.equal(policy.tier, "approval");
  assert.equal(policy.requiredRole, "manager");
  assert.ok(EXECUTABLE_ACTIONS.has("upload_document"));

  const spec = TOOL_SPECS.find((s) => s.function.name === "hermes_propose_upload_document");
  assert.ok(spec, "upload propose tool missing");
  const props = Object.keys(
    (spec!.function.parameters as { properties?: Record<string, unknown> }).properties ?? {},
  );
  assert.ok(!props.includes("file_id"), "the model must never supply a file id");
  assert.ok(!props.includes("file_name"), "the model must never supply a file name");
});

test("semantic search is gated like the document shelf, projected like the app's", () => {
  assert.equal(TOOL_COMMAND.hermes_search, "/documents");
  assert.equal(TOOL_PROJECTION.hermes_search, "semantic_search");
  const offered = specsForRole("finance", commandAllowed).map((s) => s.function.name);
  assert.ok(!offered.includes("hermes_search"), "finance must not see search snippets");
});

test("supersede keys exist only for actions that target one entity — creates never supersede", () => {
  // Twice-burned contract. A generic id-field scan first collided two
  // DIFFERENT payouts, then (rebuilt as an entity map that still scanned
  // creates) made two document uploads for the same model cancel each other —
  // the second passport silently dropped the first. The rule that survives:
  // only an action's own TARGET id keys a supersede, and absence from the map
  // IS the create case.
  assert.equal(
    supersedeKeyFor("upload_document", {
      model_id: "11111111-1111-1111-1111-111111111111",
      file_id: "AAA",
    }),
    undefined,
    "an upload (create) must never supersede another upload",
  );
  // An upsert payload WITHOUT its row id is a create — no key.
  assert.equal(
    supersedeKeyFor("upsert_account", {
      model_id: "11111111-1111-1111-1111-111111111111",
      platform_id: "22222222-2222-2222-2222-222222222222",
      username: "lily",
    }),
    undefined,
    "a new account must not supersede an unrelated pending account",
  );
  // The same action WITH its row id is an update — keyed to that row alone.
  assert.equal(
    supersedeKeyFor("upsert_account", { account_id: "33333333-3333-3333-3333-333333333333" }),
    "upsert_account:account_id:33333333-3333-3333-3333-333333333333",
  );
  // Two different payouts never collide (the original incident).
  const alice = supersedeKeyFor("mark_payout_paid", { payout_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
  const bob = supersedeKeyFor("mark_payout_paid", { payout_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  assert.ok(alice && bob && alice !== bob);
  // And every mapped action must be a real declared action.
  for (const action of Object.keys(SUPERSEDE_ID_FIELD)) {
    assert.ok(ACTION_POLICIES[action], `${action} in SUPERSEDE_ID_FIELD is not a declared action`);
  }
});
