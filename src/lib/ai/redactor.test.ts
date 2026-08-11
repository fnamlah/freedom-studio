import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactToolResult,
  scrubText,
  classificationChannel,
  RedactionError,
  RedactionRefusedError,
  BLOCKED_KEYS,
} from "./redactor.ts";

test("redactToolResult keeps only allowlisted fields", () => {
  const out = redactToolResult("payee_balances", [
    { payee_type: "model", display_name: "Nova", currency: "USD", balance: 1200, secret: "x" },
  ]);
  assert.deepEqual(out, [
    { payee_type: "model", display_name: "Nova", currency: "USD", balance: 1200 },
  ]);
});

test("redactToolResult drops blocklisted keys even when the tool projects a superset", () => {
  // payout_history does not project legal_name/email/storage_path; ensure any
  // leak of a blocked key is stripped regardless.
  const out = redactToolResult("payout_history", [
    {
      payee_name: "Nova",
      net_amount: 500,
      currency: "USD",
      status: "paid",
      legal_name: "Jane Doe",
      email: "jane@example.com",
      storage_path: "library/abc",
    },
  ]);
  const row = out[0];
  assert.equal(row.payee_name, "Nova");
  assert.ok(!("legal_name" in row));
  assert.ok(!("email" in row));
  assert.ok(!("storage_path" in row));
});

test("redactToolResult scrubs PII patterns inside allowed free-text fields", () => {
  const out = redactToolResult("payee_statement", [
    { line_type: "entry", amount: 100, description: "paid to jane@example.com ref 4111 1111 1111 1111" },
  ]);
  const desc = String(out[0].description);
  assert.ok(!desc.includes("jane@example.com"));
  assert.ok(!desc.includes("4111"));
});

test("redactToolResult is fail-closed for an unregistered tool", () => {
  assert.throws(() => redactToolResult("raw_sql", [{ any: 1 }]), RedactionError);
  assert.throws(() => redactToolResult("unknown_tool", []), RedactionError);
});

test("scrubText masks email, phone, card and IBAN shapes", () => {
  assert.ok(!scrubText("reach me at a.b@c.io").includes("@"));
  assert.equal(scrubText("card 4111-1111-1111-1111"), "card [redacted-number]");
  assert.ok(scrubText("iban GB82WEST12345698765432").includes("[redacted-iban]"));
  assert.ok(scrubText("call +1 415 555 0132 now").includes("[redacted-number]"));
});

test("every documented blocklist key is present", () => {
  for (const k of [
    "legal_name", "full_name", "date_of_birth", "email", "phone",
    "payment_details", "payment_method", "reference", "ip", "ip_hash",
    "user_agent", "storage_path", "file_name", "sha256", "token_hash",
    "token_prefix", "notes",
  ]) {
    assert.ok(BLOCKED_KEYS.has(k), `missing blocklist key: ${k}`);
  }
});

test("classificationChannel refuses ai_exempt files", () => {
  assert.throws(
    () => classificationChannel({ aiExempt: true, content: { kind: "text", text: "x" } }),
    RedactionRefusedError,
  );
});

test("classificationChannel refuses when the file's category has AI disabled", () => {
  assert.throws(
    () =>
      classificationChannel({
        aiExempt: false,
        categoryAiEnabled: false,
        content: { kind: "text", text: "x" },
      }),
    RedactionRefusedError,
  );
});

test("classificationChannel passes content through when permitted", () => {
  const content = { kind: "text", text: "an invoice" } as const;
  const out = classificationChannel({ aiExempt: false, categoryAiEnabled: true, content });
  assert.deepEqual(out, content);
});
