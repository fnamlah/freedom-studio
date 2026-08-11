import { expect, test } from "@playwright/test";

import { serviceDb, setProfileStatus } from "./helpers/admin";
import { readRun, readUsers, storageStatePath } from "./helpers/state";

/**
 * Teardown within append-only constraints (the user accepted labeled residue):
 *  - operator's unpaid pool credit is zeroed with a reversing DEDUCTION posted
 *    through the app as SA — the sanctioned correction mechanism, audited;
 *  - E2E documents / library files (bytes + rows) are removed;
 *  - E2E business entities are archived (status flip), never deleted;
 *  - test profiles are deactivated — EXCEPT e2e-sa, which stays active for the
 *    production smoke test and is deactivated at the very end of the session.
 * Permanent, labeled residue: audit_log rows, net-zero ledger_entries, the
 * paid payout, earnings (FK-referenced by ledger entries), accepted invitations.
 */

test.describe.configure({ mode: "serial" });

test.use({ storageState: storageStatePath("super_admin") });

test("zero the operator's pool credit with a reversing deduction (app path)", async ({
  page,
}) => {
  const { operatorId } = readRun();
  const db = serviceDb();
  const { data: bal } = await db
    .from("v_payee_balances")
    .select("balance")
    .eq("payee_type", "operator")
    .eq("payee_id", operatorId)
    .maybeSingle();
  const balance = Number(bal?.balance ?? 0);
  if (balance === 0) return; // already clean (re-run)

  await page.goto("/ledger");
  await page.getByRole("button", { name: "Post adjustment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#ledger-payee").selectOption(`operator:${operatorId}`);
  await dialog.locator("#ledger-type").selectOption("deduction");
  await dialog.locator("#ledger-amount").fill(String(Math.abs(balance)));
  const desc = dialog.locator("#ledger-description, textarea");
  if (await desc.count()) {
    await desc.first().fill("E2E cleanup: reverse test pool credit");
  }
  await dialog.getByRole("button", { name: "Post entry" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("v_payee_balances")
        .select("balance")
        .eq("payee_type", "operator")
        .eq("payee_id", operatorId)
        .maybeSingle();
      return Number(data?.balance ?? 0);
    })
    .toBe(0);
});

test("cancel leftover E2E pending payouts", async () => {
  const { modelId, operatorId } = readRun();
  const db = serviceDb();
  for (const [type, id] of [["model", modelId], ["operator", operatorId]] as const) {
    if (!id) continue;
    await db
      .from("payouts")
      .update({ status: "cancelled" })
      .eq("payee_type", type)
      .eq("payee_id", id)
      .in("status", ["pending", "approved"]);
  }
  const { data: left } = await db
    .from("payouts")
    .select("id")
    .in("status", ["pending", "approved"])
    .in("payee_id", [modelId, operatorId].filter(Boolean));
  expect(left ?? []).toEqual([]);
});

test("remove E2E document and library bytes + rows", async () => {
  const db = serviceDb();

  // Documents (shares first — FK), then storage objects, then rows.
  const { data: docs } = await db.from("documents").select("id, storage_path").ilike("title", "E2E-%");
  for (const doc of docs ?? []) {
    await db.from("document_shares").delete().eq("document_id", doc.id);
    const path = doc.storage_path.replace(/^model-documents\//, "");
    await db.storage.from("model-documents").remove([path]);
    await db.from("documents").delete().eq("id", doc.id);
  }

  const { data: files } = await db.from("library_files").select("id, storage_path").ilike("name", "E2E-%");
  for (const file of files ?? []) {
    const path = file.storage_path.replace(/^library\//, "");
    await db.storage.from("library").remove([path]);
    await db.from("library_files").delete().eq("id", file.id);
  }

  const { data: docsLeft } = await db.from("documents").select("id").ilike("title", "E2E-%");
  const { data: filesLeft } = await db.from("library_files").select("id").ilike("name", "E2E-%");
  expect(docsLeft).toEqual([]);
  expect(filesLeft).toEqual([]);
});

test("archive E2E business entities (status flip, never delete)", async () => {
  const db = serviceDb();
  await db.from("models").update({ status: "inactive" }).ilike("stage_name", "E2E-%");
  await db.from("operators").update({ status: "inactive" }).ilike("display_name", "E2E-%");
  await db.from("platform_accounts").update({ status: "closed" }).eq("username", "e2e_m1_account");

  const { data: activeLeft } = await db
    .from("models")
    .select("id")
    .ilike("stage_name", "E2E-%")
    .eq("status", "active");
  expect(activeLeft).toEqual([]);
});

test("deactivate test users (e2e-sa stays for the production smoke)", async () => {
  const users = readUsers();
  for (const role of ["manager", "finance", "model", "operator"] as const) {
    const user = users[role];
    if (user) await setProfileStatus(user.userId, "deactivated");
  }
  const db = serviceDb();
  const { data: profiles } = await db
    .from("profiles")
    .select("status, role")
    .in(
      "id",
      (["manager", "finance", "model", "operator"] as const)
        .map((r) => users[r]?.userId)
        .filter((id): id is string => Boolean(id)),
    );
  for (const p of profiles ?? []) {
    expect(p.status).toBe("deactivated");
  }
});

test("deactivated users read zero rows (dormant accounts are inert)", async () => {
  const { dbAs } = await import("./helpers/db");
  // The manager's JWT is still technically valid — but the restrictive
  // active-profile policy must now return nothing.
  const { data } = await dbAs("manager").from("models").select("id");
  expect(data ?? []).toEqual([]);
});
