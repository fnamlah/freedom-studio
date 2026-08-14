import assert from "node:assert/strict";
import test from "node:test";

import { isPaydayWindow, lastCompleteWeek, payoutDraftKey } from "./payday-week.js";

test("the payday window is Wednesday through Saturday, UTC", () => {
  // 2026-08-09 is a Sunday.
  const days = ["09", "10", "11", "12", "13", "14", "15"]; // Sun..Sat
  const expected = [false, false, false, true, true, true, true];
  days.forEach((d, i) => {
    assert.equal(
      isPaydayWindow(new Date(`2026-08-${d}T10:00:00Z`)),
      expected[i],
      `2026-08-${d} window`,
    );
  });
});

test("lastCompleteWeek is Sunday–Saturday and never includes today", () => {
  // Wednesday 2026-08-19 → the week 2026-08-09 (Sun) .. 2026-08-15 (Sat).
  assert.deepEqual(lastCompleteWeek(new Date("2026-08-19T09:00:00Z")), {
    start: "2026-08-09",
    end: "2026-08-15",
  });
  // Sunday: the week ended yesterday.
  assert.deepEqual(lastCompleteWeek(new Date("2026-08-16T09:00:00Z")), {
    start: "2026-08-09",
    end: "2026-08-15",
  });
  // THE EDGE: a Saturday run reports the week that ended LAST Saturday —
  // today's week is not over until midnight.
  assert.deepEqual(lastCompleteWeek(new Date("2026-08-15T09:00:00Z")), {
    start: "2026-08-02",
    end: "2026-08-08",
  });
});

test("payout draft keys are one per payee per currency per week-end", () => {
  const a = payoutDraftKey("model", "id-a", "2026-08-15");
  const b = payoutDraftKey("model", "id-b", "2026-08-15");
  const aNext = payoutDraftKey("model", "id-a", "2026-08-22");
  const aEur = payoutDraftKey("model", "id-a", "2026-08-15", "EUR");
  assert.equal(a, "payout:model:id-a:USD:2026-08-15");
  assert.notEqual(a, b); // two payees never collide (the B1 lesson)
  assert.notEqual(a, aNext); // a new week is a new draft
  // Balances are per (payee, currency): without the currency term the second
  // currency's draft deduped into the first's pending approval and vanished.
  assert.notEqual(a, aEur);
});
