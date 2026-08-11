import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { readRun, readUsers } from "./helpers/state";

/**
 * Scenario 8 — the audit trail: one service-level pass over `audit_log`
 * asserting that everything the suite just did left its dotted-verb record,
 * attributed to the RIGHT actor. The sharpest line: `payout.approve` must be
 * the super admin, never finance.
 */

test("audit_log carries the full dotted-verb trail with correct actors", async () => {
  const users = readUsers();
  const run = readRun();
  const db = serviceDb();

  const { data: rows, error } = await db
    .from("audit_log")
    .select("action, actor_id, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  expect(error).toBeNull();
  const log = rows ?? [];

  const has = (action: string) => log.some((r) => r.action === action);
  const actorsOf = (action: string) =>
    new Set(log.filter((r) => r.action === action).map((r) => r.actor_id));

  // Lifecycle + studio + money + documents + library — all present.
  for (const verb of [
    "auth.mfa_enrolled",
    "model.create",
    "platform.create",
    "account.create",
    "earning.create",
    "ledger.post",
    "payout.create",
    "payout.approve",
    "payout.paid",
    "document.upload",
    "share.create",
    "share.revoke",
    "library.upload",
  ]) {
    expect(has(verb), `audit_log missing ${verb}`).toBe(true);
  }

  // Maker-checker attribution: approve = SA only; create/paid include finance.
  const saId = users.super_admin!.userId;
  const finId = users.finance!.userId;
  const approveActors = actorsOf("payout.approve");
  expect(approveActors.has(saId)).toBe(true);
  expect(approveActors.has(finId), "finance must never appear as payout approver").toBe(false);
  expect(actorsOf("payout.create").has(finId)).toBe(true);
  expect(actorsOf("payout.paid").has(finId)).toBe(true);

  // The close-period run is recorded against the finance user.
  const closeRows = log.filter(
    (r) => r.action === "ledger.post" && String(r.entity_id).includes(".."),
  );
  expect(closeRows.length).toBeGreaterThanOrEqual(1);
  expect(closeRows.some((r) => r.actor_id === finId)).toBe(true);

  // Payout entity ids tie back to the payout the suite created.
  if (run.payoutId) {
    expect(
      log.some((r) => r.action === "payout.approve" && r.entity_id === run.payoutId),
    ).toBe(true);
  }
});

test("audit_log and ledger_entries refuse tampering even from the service role", async () => {
  const db = serviceDb();
  const { data: victim } = await db
    .from("audit_log")
    .select("id, action")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // The service role bypasses RLS, so append-only is enforced by the 013
  // statement triggers — every mutation must be refused with 42501.
  const upd = await db
    .from("audit_log")
    .update({ action: "tampered" })
    .eq("id", victim!.id)
    .select("id");
  expect(upd.error?.code, "audit_log UPDATE must be refused").toBe("42501");

  const del = await db.from("audit_log").delete().eq("id", victim!.id).select("id");
  expect(del.error?.code, "audit_log DELETE must be refused").toBe("42501");

  const led = await db
    .from("ledger_entries")
    .update({ description: "tampered" })
    .gt("id", 0)
    .select("id");
  expect(led.error?.code, "ledger_entries UPDATE must be refused").toBe("42501");

  const { data: still } = await db
    .from("audit_log")
    .select("id, action")
    .eq("id", victim!.id)
    .single();
  expect(still?.id).toBe(victim!.id);
  expect(still?.action).toBe(victim!.action);
});
