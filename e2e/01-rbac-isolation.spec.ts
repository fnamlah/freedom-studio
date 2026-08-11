import { expect, test } from "@playwright/test";

import { dbAs } from "./helpers/db";
import { ROLES, type E2ERole } from "./helpers/naming";
import { readRun } from "./helpers/state";
import { storageStatePath } from "./helpers/state";

/**
 * Scenario 2 — per-role isolation, asserted at BOTH layers:
 *  - UI: the nav a role sees mirrors src/components/shell/nav.ts, and direct
 *    URLs outside the role's surface land on /forbidden;
 *  - database boundary: PostgREST probes with the role's own AAL2 JWT (the
 *    stolen-token perspective) — finance reads 0 documents, operator reads 0
 *    raw earnings, a model reads exactly their own rows.
 */

/** Mirror of nav.ts — labels each role must and must not see. */
const NAV_VISIBLE: Record<E2ERole, string[]> = {
  super_admin: ["Dashboard", "Models", "Documents", "Library", "Ledger", "AI assistant", "Users", "Settings"],
  manager: ["Dashboard", "Models", "Documents", "Library", "Ledger", "AI assistant"],
  finance: ["Dashboard", "Ledger", "Payouts", "Statements", "Forecasts", "AI assistant", "AI reports"],
  model: ["Dashboard", "Ledger", "Payouts", "Statements"],
  operator: ["Dashboard", "Ledger", "Payouts", "Statements"],
};

const NAV_HIDDEN: Record<E2ERole, string[]> = {
  super_admin: [],
  manager: ["Users", "Invitations", "Audit log", "Settings", "AI reports"],
  finance: ["Models", "Operators", "Documents", "Library", "Commission schemes", "Users"],
  model: ["Models", "Documents", "Library", "Earnings", "AI assistant", "Users", "Forecasts"],
  operator: ["Models", "Documents", "Library", "Earnings", "AI assistant", "Users", "Forecasts"],
};

for (const role of ROLES) {
  test(`nav for ${role} matches the capability matrix`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath(role) });
    const page = await context.newPage();
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    for (const label of NAV_VISIBLE[role]) {
      await expect(nav.getByRole("link", { name: label, exact: true }), `${role} sees ${label}`).toBeVisible();
    }
    for (const label of NAV_HIDDEN[role]) {
      await expect(nav.getByRole("link", { name: label, exact: true }), `${role} must NOT see ${label}`).toHaveCount(0);
    }
    await context.close();
  });
}

test("direct URLs outside a role's surface are refused (UX layer)", async ({ browser }) => {
  const probes: Array<[E2ERole, string]> = [
    ["finance", "/documents"],
    ["finance", "/models"],
    ["operator", "/earnings"],
    ["model", "/earnings"],
    ["model", "/admin/users"],
    ["operator", "/library"],
    ["finance", "/admin/settings"],
  ];
  for (const [role, path] of probes) {
    const context = await browser.newContext({ storageState: storageStatePath(role) });
    const page = await context.newPage();
    await page.goto(path);
    await expect(page, `${role} at ${path}`).toHaveURL(/\/forbidden/);
    await context.close();
  }
});

test("RLS: finance reads zero documents at the database boundary", async () => {
  const { data, error } = await dbAs("finance").from("documents").select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test("RLS: operator reads zero raw earnings at the database boundary", async () => {
  const { data, error } = await dbAs("operator").from("earnings").select("id");
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test("RLS: model reads exactly their own model row and nobody else's", async () => {
  const { modelId } = readRun();
  const { data, error } = await dbAs("model").from("models").select("id");
  expect(error).toBeNull();
  expect(data?.map((r) => r.id)).toEqual([modelId]);
});

test("RLS: model cannot read other payees' ledger entries", async () => {
  const { modelId } = readRun();
  const { data, error } = await dbAs("model").from("ledger_entries").select("payee_id, payee_type");
  expect(error).toBeNull();
  for (const row of data ?? []) {
    expect(row.payee_type).toBe("model");
    expect(row.payee_id).toBe(modelId);
  }
});

test("RLS: manager cannot read profiles beyond what the matrix grants writes to", async () => {
  // Managers read business tables but must not be able to ESCALATE: a direct
  // update of their own profile role must affect 0 rows.
  const db = dbAs("manager");
  const { data: me } = await db.from("profiles").select("id, role").eq("role", "manager");
  const mine = me?.[0];
  expect(mine).toBeTruthy();
  const { data: updated, error } = await db
    .from("profiles")
    .update({ role: "super_admin" })
    .eq("id", mine!.id)
    .select("id");
  // Either an RLS error or, with a permissive-read policy, an empty update set.
  if (error) {
    expect(error.message).toBeTruthy();
  } else {
    expect(updated).toEqual([]);
  }
  // Confirm nothing changed.
  const { data: after } = await db.from("profiles").select("role").eq("id", mine!.id).single();
  expect(after?.role).toBe("manager");
});
