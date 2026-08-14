import assert from "node:assert/strict";
import test from "node:test";

import { canRecoverFromStall, type StallContext } from "./recovery.js";

/** The incident, as a fixture: round 2 stalled at 25s of a 60s budget. */
const incident: StallContext = {
  errorName: "TimeoutError",
  turnAborted: false,
  toolRuns: 1,
  alreadyRecovered: false,
  budgetLeftMs: 60_000 - 30_858,
  minBudgetMs: 26_000,
};

test("the incident that prompted this is recoverable", () => {
  // 29.1s left against a 26s floor — the headroom provider.ts reserved and
  // nothing used. This assertion IS the bug report.
  assert.equal(canRecoverFromStall(incident), true);
});

test("only a per-request timeout recovers", () => {
  for (const errorName of ["AbortError", "TypeError", "Error", undefined]) {
    assert.equal(canRecoverFromStall({ ...incident, errorName }), false, `${errorName} must not recover`);
  }
});

test("a fired turn deadline is final", () => {
  assert.equal(canRecoverFromStall({ ...incident, turnAborted: true }), false);
});

test("a round-1 stall does not recover — there is nothing to answer from", () => {
  // The one thing this bot must never do is invent a figure. With no tool
  // results in hand, a "conclude from what you have" call has nothing.
  assert.equal(canRecoverFromStall({ ...incident, toolRuns: 0 }), false);
});

test("recovery is spent once; a second stall means the provider is down", () => {
  assert.equal(canRecoverFromStall({ ...incident, alreadyRecovered: true }), false);
});

test("a recovery that cannot finish is not started", () => {
  // Below the per-request ceiling this only swaps a provider timeout for a
  // turn-deadline abort: a different error and the same silence.
  assert.equal(canRecoverFromStall({ ...incident, budgetLeftMs: 25_999 }), false);
  assert.equal(canRecoverFromStall({ ...incident, budgetLeftMs: 26_001 }), true);
});

test("a stall late in a slow turn is not recovered", () => {
  // 4 rounds of genuinely slow-but-successful calls leave no room, and pushing
  // past the deadline would hold Alina's slot in silence.
  assert.equal(canRecoverFromStall({ ...incident, budgetLeftMs: 3_000 }), false);
});
