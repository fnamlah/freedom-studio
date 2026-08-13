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
import { specsForRole, TOOL_COMMAND } from "../llm/tool-catalog.js";
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
  for (const tool of Object.keys(TOOL_COMMAND)) {
    // `hermes_balances` deliberately reuses the app's `payee_balances`
    // projection: it is the same view, so it must not get a second, drifting
    // definition of what may leave.
    const projected = tool === "hermes_balances" ? "payee_balances" : tool;
    assert.ok(
      PROJECTIONS[projected],
      `${tool} has no egress projection — it would throw at run time`,
    );
  }
});

test("conversational tools carry no identity fields into a projection", () => {
  const blocked = Array.isArray(BLOCKED_KEYS) ? BLOCKED_KEYS : [...BLOCKED_KEYS];
  for (const tool of Object.keys(TOOL_COMMAND)) {
    const projected = tool === "hermes_balances" ? "payee_balances" : tool;
    for (const field of PROJECTIONS[projected] ?? []) {
      assert.ok(
        !blocked.includes(field),
        `${tool} projects "${field}", which is on the blocklist`,
      );
    }
  }
});

test("a role is never offered a tool it may not run", () => {
  for (const role of ["super_admin", "manager", "finance"]) {
    const offered = specsForRole(role, commandAllowed).map((s) => s.function.name);
    for (const name of offered) {
      assert.ok(
        commandAllowed(role, TOOL_COMMAND[name]!),
        `${role} was offered ${name} but may not run it`,
      );
    }
    // Every role that may hold a channel must get something to work with,
    // otherwise the conversation is decorative for them.
    assert.ok(offered.length > 0, `${role} was offered no tools at all`);
  }
});

test("the conversational surface exposes no write tool", () => {
  // Approving stays a button press routed through `decide_approval`, which
  // re-checks the actor's role in the database. Nothing the model can call
  // may mutate; the names are asserted rather than the behaviour because a
  // write tool would most likely arrive as a new, plausibly-named entry.
  for (const tool of Object.keys(TOOL_COMMAND)) {
    assert.doesNotMatch(
      tool,
      /create|update|delete|approve|reject|close|post|pay|set_|write/i,
      `${tool} reads as a mutation — the chat surface is read-only`,
    );
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
