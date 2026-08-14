import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { MODEL_MESSAGES_EN, modelProfileFields } from "./models.js";
import {
  ASSIGNMENT_MESSAGES_EN,
  OPERATOR_MESSAGES_EN,
  assignmentFields,
  endAfterStart,
  operatorProfileFields,
} from "./operators.js";
import { PLATFORM_MESSAGES_EN, accountEditableFields, platformFields } from "./platforms.js";

/**
 * Parity, in the only sense that matters: these rules were MOVED out of the
 * `"use server"` action files so the Telegram bot could import them, and the
 * manual forms must not have changed behaviour in the process. Each case below
 * is one the web form already handled — the same accept, the same refusal.
 *
 * Messages are supplied by the caller (the app passes the caller's dictionary,
 * the worker passes English), so these assert against the English defaults. The
 * RULES are what is shared; the words are not.
 */

const model = z.object(modelProfileFields(MODEL_MESSAGES_EN));
const operator = z.object(operatorProfileFields(OPERATOR_MESSAGES_EN));
const platform = z.object(platformFields(PLATFORM_MESSAGES_EN));
const account = z.object(accountEditableFields(PLATFORM_MESSAGES_EN));

const validModel = {
  stage_name: "Лилия",
  legal_name: "L. Example",
  date_of_birth: "1998-04-11",
  commission_percent: 60,
};

test("a well-formed model passes, exactly as the form accepts it", () => {
  assert.equal(model.safeParse(validModel).success, true);
});

test("the 18+ gate holds", () => {
  const under = new Date();
  under.setUTCFullYear(under.getUTCFullYear() - 16);
  const r = model.safeParse({ ...validModel, date_of_birth: under.toISOString().slice(0, 10) });
  assert.equal(r.success, false);
  assert.equal(r.error?.issues[0]?.message, MODEL_MESSAGES_EN.adult);
});

test("31 February is not a date", () => {
  assert.equal(model.safeParse({ ...validModel, date_of_birth: "1998-02-31" }).success, false);
});

test("empty optional strings become null rather than failing", () => {
  const r = model.safeParse({ ...validModel, email: "", phone: "", notes: "" });
  assert.equal(r.success, true);
  assert.equal(r.data?.email, null);
  assert.equal(r.data?.phone, null);
});

test("country is upper-cased, and only two letters", () => {
  assert.equal(model.safeParse({ ...validModel, country: "pl" }).data?.country, "PL");
  assert.equal(model.safeParse({ ...validModel, country: "POL" }).success, false);
});

test("commission is bounded 0-100 and coerced from a form string", () => {
  assert.equal(model.safeParse({ ...validModel, commission_percent: "45" }).data?.commission_percent, 45);
  assert.equal(model.safeParse({ ...validModel, commission_percent: 101 }).success, false);
  assert.equal(model.safeParse({ ...validModel, commission_percent: -1 }).success, false);
});

test("a team member defaults to operator, and takes coach or team_leader", () => {
  const base = { display_name: "Marta", legal_name: "M. Example" };
  assert.equal(operator.safeParse(base).data?.staff_role, "operator");
  assert.equal(operator.safeParse({ ...base, staff_role: "coach" }).data?.staff_role, "coach");
  assert.equal(operator.safeParse({ ...base, staff_role: "manager" }).success, false);
});

test("a team member needs both names", () => {
  assert.equal(operator.safeParse({ display_name: "Marta" }).success, false);
  assert.equal(operator.safeParse({ legal_name: "M. Example" }).success, false);
});

test("a website URL gains a scheme rather than being rejected", () => {
  assert.equal(platform.safeParse({ name: "Stripchat", website_url: "stripchat.com" }).data?.website_url,
    "https://stripchat.com");
  assert.equal(platform.safeParse({ name: "X", website_url: "not a url" }).success, false);
});

test("a platform fee is optional, nullable, and bounded", () => {
  assert.equal(account.safeParse({ username: "lily" }).success, true);
  assert.equal(account.safeParse({ username: "lily", platform_fee_percent: "" }).data?.platform_fee_percent, null);
  assert.equal(account.safeParse({ username: "lily", platform_fee_percent: 35 }).data?.platform_fee_percent, 35);
  assert.equal(account.safeParse({ username: "lily", platform_fee_percent: 101 }).success, false);
});

test("an assignment's end date must be after its start", () => {
  const fields = z.object(assignmentFields(ASSIGNMENT_MESSAGES_EN));
  const ok = fields.safeParse({
    pool_share_percent: 50,
    assigned_from: "2026-01-01",
    assigned_to: "2026-06-01",
  });
  assert.equal(ok.success, true);
  assert.equal(endAfterStart(ok.data!), true);

  const backwards = fields.safeParse({
    pool_share_percent: 50,
    assigned_from: "2026-06-01",
    assigned_to: "2026-01-01",
  });
  assert.equal(endAfterStart(backwards.data!), false);
});

test("an open-ended assignment is legal", () => {
  assert.equal(endAfterStart({ assigned_from: "2026-01-01", assigned_to: null }), true);
});
