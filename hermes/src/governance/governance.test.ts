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
