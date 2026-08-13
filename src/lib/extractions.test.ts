import { test } from "node:test";
import assert from "node:assert/strict";

import {
  expenseFields,
  matchAccount,
  parseRecords,
  type AccountCandidate,
} from "./extractions";
import { dict } from "./i18n";
import { z } from "zod";

/**
 * The extraction pipeline's pure parts (021):
 *
 *  1. `parseRecords` — the gate between what a model CLAIMS and what reaches
 *     the review queue. Malformed proposals must vanish, never throw, and
 *     never take the classification down with them.
 *  2. `matchAccount` — printed platform/username → account id. The rule under
 *     test is "never guess": zero or ambiguous matches return null.
 *  3. `expenseFields` — canonical (no manual form exists); the DB's
 *     `amount > 0` and vendor rules must hold at the schema layer too.
 */

/* ------------------------------------------------------------ parseRecords --- */

const earningsRecords = (rows: unknown[]) => ({ kind: "earnings", rows });

test("parseRecords accepts a well-formed earnings block", () => {
  const parsed = parseRecords(
    earningsRecords([
      {
        platform: "Stripchat",
        username: "lily_x",
        period_start: "2026-08-01",
        period_end: "2026-08-07",
        gross_amount: 1200.5,
        fee_amount: 120.05,
        net_amount: 1080.45,
        currency: "usd",
      },
    ]),
  );
  assert.equal(parsed?.kind, "earnings");
  assert.equal(parsed?.rows.length, 1);
  // Providers sometimes send lowercase; the schema normalizes, apply re-checks.
  assert.equal((parsed?.rows[0] as { currency?: string }).currency, "USD");
});

test("parseRecords coerces stringified amounts (a provider habit)", () => {
  const parsed = parseRecords(
    earningsRecords([
      {
        period_start: "2026-08-01",
        period_end: "2026-08-07",
        gross_amount: "1000.00",
        net_amount: "900.00",
      },
    ]),
  );
  assert.equal(parsed?.kind, "earnings");
  assert.equal((parsed?.rows[0] as { net_amount: number }).net_amount, 900);
});

test("parseRecords drops a half-read date rather than passing it through", () => {
  // "March 2026" and "2026-03" are the classic partial reads. Both must kill
  // the block: a date that LOOKS authoritative on the review screen but was
  // guessed is exactly what the prompt forbids.
  for (const bad of ["2026-03", "March 2026", "2026-02-31"]) {
    const parsed = parseRecords(
      earningsRecords([
        { period_start: bad, period_end: "2026-08-07", gross_amount: 1, net_amount: 1 },
      ]),
    );
    assert.equal(parsed, undefined, `expected ${bad} to be rejected`);
  }
});

test("parseRecords treats explicit null / empty-string optionals as absent", () => {
  // Providers are fond of `"field": null` where they mean "not present"; that
  // must not vaporise a whole proposal.
  const parsed = parseRecords(
    earningsRecords([
      {
        platform: null,
        username: "",
        period_start: "2026-08-01",
        period_end: "2026-08-07",
        gross_amount: 1000,
        fee_amount: null,
        net_amount: 900,
        currency: null,
      },
    ]),
  );
  assert.equal(parsed?.kind, "earnings");
  const row = parsed?.rows[0] as Record<string, unknown>;
  assert.equal(row.platform, undefined);
  assert.equal(row.username, undefined);
  assert.equal(row.currency, undefined);
});

test("parseRecords rejects out-of-range clock times like 24:00", () => {
  // "24:00" is a real shift-report convention, but it renders as a BLANK
  // datetime-local input while the junk value still submits — reject at the gate.
  for (const bad of ["2026-08-01T24:00", "2026-08-01T20:61"]) {
    const parsed = parseRecords({ kind: "sessions", rows: [{ started_at: bad }] });
    assert.equal(parsed, undefined, `expected ${bad} to be rejected`);
  }
});

test("parseRecords rejects unknown kinds, empty rows, and non-objects", () => {
  assert.equal(parseRecords({ kind: "payouts", rows: [{}] }), undefined);
  assert.equal(parseRecords({ kind: "earnings", rows: [] }), undefined);
  assert.equal(parseRecords("earnings"), undefined);
  assert.equal(parseRecords(null), undefined);
  assert.equal(parseRecords(undefined), undefined);
});

test("parseRecords rejects a block above the row cap", () => {
  const row = {
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    gross_amount: 1,
    net_amount: 1,
  };
  assert.equal(parseRecords(earningsRecords(Array(51).fill(row))), undefined);
  assert.notEqual(parseRecords(earningsRecords(Array(50).fill(row))), undefined);
});

test("parseRecords accepts sessions with datetime-local timestamps only", () => {
  const good = parseRecords({
    kind: "sessions",
    rows: [{ started_at: "2026-08-01T20:00", ended_at: "2026-08-02T02:30" }],
  });
  assert.equal(good?.kind, "sessions");

  // A bare date or an ISO-with-zone is not what the manual form submits.
  for (const bad of ["2026-08-01", "2026-08-01T20:00:00Z"]) {
    const parsed = parseRecords({ kind: "sessions", rows: [{ started_at: bad }] });
    assert.equal(parsed, undefined, `expected ${bad} to be rejected`);
  }
});

test("parseRecords rejects an expense of zero", () => {
  const parsed = parseRecords({
    kind: "expenses",
    rows: [{ incurred_on: "2026-08-01", vendor: "OBS Store", amount: 0 }],
  });
  assert.equal(parsed, undefined);
});

/* ------------------------------------------------------------ matchAccount --- */

const ACCOUNTS: AccountCandidate[] = [
  { id: "a-1", username: "lily_x", platformName: "Stripchat" },
  { id: "a-2", username: "lily_x", platformName: "Chaturbate" },
  { id: "a-3", username: "vera", platformName: "Stripchat" },
];

test("matchAccount resolves a unique username regardless of case and @", () => {
  assert.equal(matchAccount({ username: "VERA" }, ACCOUNTS), "a-3");
  assert.equal(matchAccount({ username: "@vera " }, ACCOUNTS), "a-3");
});

test("matchAccount uses the printed platform to break a username tie", () => {
  assert.equal(matchAccount({ username: "lily_x", platform: "Chaturbate" }, ACCOUNTS), "a-2");
  // Partial platform names still disambiguate ("Strip" ⊂ "Stripchat").
  assert.equal(matchAccount({ username: "lily_x", platform: "Strip" }, ACCOUNTS), "a-1");
});

test("matchAccount never guesses: ambiguous or unknown → null", () => {
  // Two accounts share the username; no platform printed.
  assert.equal(matchAccount({ username: "lily_x" }, ACCOUNTS), null);
  // Platform printed but it fits both no better.
  assert.equal(matchAccount({ username: "lily_x", platform: "??" }, ACCOUNTS), null);
  // Unknown username entirely.
  assert.equal(matchAccount({ username: "nobody" }, ACCOUNTS), null);
  // Nothing printed at all.
  assert.equal(matchAccount({}, ACCOUNTS), null);
});

/* ----------------------------------------------------------- expenseFields --- */

const expenseSchema = z.object(expenseFields(dict("en")));

test("expenseFields enforces the DB's amount > 0 rule at the schema layer", () => {
  const base = { incurred_on: "2026-08-01", vendor: "OBS Store", amount: "49.99" };
  assert.equal(expenseSchema.safeParse(base).success, true);
  assert.equal(expenseSchema.safeParse({ ...base, amount: "0" }).success, false);
  assert.equal(expenseSchema.safeParse({ ...base, amount: "-5" }).success, false);
});

test("expenseFields requires a vendor and a real calendar date", () => {
  assert.equal(
    expenseSchema.safeParse({ incurred_on: "2026-02-31", vendor: "X", amount: "1" }).success,
    false,
  );
  assert.equal(
    expenseSchema.safeParse({ incurred_on: "2026-08-01", vendor: "  ", amount: "1" }).success,
    false,
  );
});

test("expenseFields defaults an omitted currency to USD (data, not display)", () => {
  const parsed = expenseSchema.parse({
    incurred_on: "2026-08-01",
    vendor: "OBS Store",
    amount: "1",
  });
  assert.equal(parsed.currency, "USD");
});
