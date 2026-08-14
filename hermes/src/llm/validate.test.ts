import assert from "node:assert/strict";
import test from "node:test";

import {
  documentUploadProposal,
  accountProposal,
  payoutProposal,
  assignmentProposal,
  modelProposal,
  operatorProposal,
  platformProposal,
  rateCardProposal,
  schemeProposal,
  validate,
} from "./validate.js";

/**
 * These assert the property the whole shared-fields exercise exists for: a
 * value the WEB FORM would refuse is refused HERE, before a card is queued,
 * naming the reason.
 *
 * The failure mode they prevent is specific and was real. The bot's write path
 * checked "is a string" and "is a number" and sent the rest to Postgres. For
 * `operators` — which carries no CHECK constraints at all — that meant nothing
 * anywhere caught a bad value. For everything else it meant the approver read a
 * plausible sentence, tapped Approve, and got a raw SQLSTATE.
 *
 * Every schema imported above is built from the SAME objects
 * `src/app/(app)/*_/actions.ts` use. That is what makes these tests meaningful
 * rather than a second, drifting definition being tested against itself.
 */

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail("expected a refusal, got none");
}

test("a model born under 18 is refused, in words", () => {
  const soon = new Date();
  soon.setUTCFullYear(soon.getUTCFullYear() - 17);
  const message = refusal(() =>
    validate(modelProposal, { stage_name: "Test", date_of_birth: soon.toISOString().slice(0, 10) }),
  );
  assert.match(message, /18/);
});

test("an impossible calendar date is refused", () => {
  assert.match(
    refusal(() => validate(modelProposal, { date_of_birth: "1998-02-30" })),
    /real date|YYYY-MM-DD/i,
  );
});

test("a three-letter country code is refused on both people tables", () => {
  assert.match(
    refusal(() => validate(modelProposal, { country: "POL" })),
    /2-letter|country/i,
  );
  assert.match(
    refusal(() => validate(operatorProposal, { display_name: "M", country: "POL" })),
    /2-letter|country/i,
  );
});

test("a two-letter country code is accepted and upper-cased", () => {
  assert.equal(validate(operatorProposal, { display_name: "M", country: "pl" }).country, "PL");
});

test("an assignment ending before it starts is refused", () => {
  assert.match(
    refusal(() =>
      validate(assignmentProposal, { assigned_from: "2026-03-01", assigned_to: "2026-02-01" }),
    ),
    /after the start/i,
  );
});

test("a pool share over 100 is refused", () => {
  assert.match(
    refusal(() => validate(assignmentProposal, { assigned_from: "2026-03-01", pool_share_percent: 140 })),
    /100/,
  );
});

test("a platform fee over 100 is refused", () => {
  // `platform_accounts` DOES have a CHECK for this, but the fee is what every
  // future net figure divides by, so being told in conversation beats a 23514
  // after the tap.
  assert.match(
    refusal(() => validate(accountProposal, { username: "x", platform_fee_percent: 900 })),
    /100/,
  );
});

test("a scheme whose three shares do not total 100 is refused", () => {
  assert.match(
    refusal(() =>
      validate(schemeProposal, {
        model_percent: 60,
        operator_percent: 30,
        studio_percent: 30,
        effective_from: "2026-01-01",
      }),
    ),
    /add up to 100/i,
  );
});

test("a scheme whose shares total 100 passes", () => {
  const ok = validate(schemeProposal, {
    model_percent: 60,
    operator_percent: 25,
    studio_percent: 15,
    effective_from: "2026-01-01",
  });
  assert.equal(ok.model_percent, 60);
});

test("a rate card naming a role that does not exist is refused", () => {
  assert.match(
    refusal(() => validate(rateCardProposal, [{ party: "manager", min_amount: 0, percent: 10 }])),
    /model_with_operator|Role must be one of/,
  );
});

test("a rate card is refused rather than silently emptied", () => {
  assert.match(
    refusal(() => validate(rateCardProposal, [])),
    /at least one/i,
  );
});

test("an omitted field stays omitted — a patch never blanks a column", () => {
  // The wrappers `coalesce` absent parameters to the existing value, so an
  // update naming only a phone number must not carry `display_name: undefined`
  // in a way that reads as "set it to null".
  const patch = validate(operatorProposal, { phone: "+48 555 111 222" });
  assert.equal(patch.display_name, undefined);
  assert.equal(patch.phone, "+48 555 111 222");
});

test("a malformed email is refused before it reaches a card", () => {
  assert.match(
    refusal(() => validate(operatorProposal, { display_name: "M", email: "not-an-address" })),
    /email/i,
  );
});

test("the refusal names the field, so the model can say which one", () => {
  assert.match(
    refusal(() => validate(operatorProposal, { display_name: "M", country: "POL" })),
    /^country:/,
  );
});

test("a payout with an inverted period is refused", () => {
  assert.match(
    refusal(() =>
      validate(payoutProposal, { period_start: "2026-08-01", period_end: "2026-07-01", net_amount: 100 }),
    ),
    /before its start/i,
  );
});

test("a payout of zero or negative money is refused", () => {
  for (const bad of [0, -50]) {
    assert.match(
      refusal(() =>
        validate(payoutProposal, { period_start: "2026-07-01", period_end: "2026-07-31", net_amount: bad }),
      ),
      /above zero/i,
    );
  }
});

test("a payout currency must be a 3-letter code", () => {
  assert.match(
    refusal(() =>
      validate(payoutProposal, {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        net_amount: 100,
        currency: "dollars",
      }),
    ),
    /3-letter/i,
  );
  // lower-case is normalised, not refused
  const ok = validate(payoutProposal, {
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    net_amount: 100,
    currency: "usd",
  });
  assert.equal(ok.currency, "USD");
});

test("a well-formed payout passes", () => {
  const ok = validate(payoutProposal, {
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    net_amount: 1250.5,
  });
  assert.equal(ok.net_amount, 1250.5);
});

test("a document upload validates its dates and title like the portal", () => {
  assert.match(
    refusal(() => validate(documentUploadProposal, { title: "Passport", expires_at: "2027-02-30" })),
    /real date/i,
  );
  assert.match(
    refusal(() => validate(documentUploadProposal, { title: "   " })),
    /title/i,
  );
  const ok = validate(documentUploadProposal, {
    title: "Passport 2026",
    doc_type: "passport",
    expires_at: "2027-06-01",
  });
  assert.equal(ok.doc_type, "passport");
});
