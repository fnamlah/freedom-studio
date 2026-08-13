import { expect, test, type Page } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { e2eName } from "./helpers/naming";
import { readRun, storageStatePath, writeRun } from "./helpers/state";

/**
 * Scenario 3 — the money chain: model → platform → platform account →
 * operator assignment → earning → "Close period" → ledger credits reconcile to
 * the cent against the default 60/10/30 scheme → re-run is idempotent.
 *
 * Creation happens through the real UI as manager; the close runs as finance
 * (also proving finance CAN close periods, the counterpart of 03's negative).
 */

const PERIOD_START = "2026-08-10"; // ≥ default scheme effective_from
const PERIOD_END = "2026-08-11";
const GROSS = "1000";
const NET = "1000"; // fee 0 keeps the reconciliation arithmetic exact
// The studio rate card (025) prices this: a $1,000 Sunday–Saturday week for a
// model WITH AN OPERATOR sits in the lowest bracket, so she takes 45% and the
// operator 25% — not the scheme's own 60/10/30, which now only applies to
// schemes carrying no card.
const EXPECTED_MODEL_SHARE = 450.0; // model_with_operator @ <=1500
const EXPECTED_OPERATOR_SHARE = 250.0; // operator @ <=1500

test.describe.configure({ mode: "serial" });

async function selectByLabel(page: Page, id: string, label: string): Promise<void> {
  await page.locator(`#${id}`).selectOption({ label });
}

test.use({ storageState: storageStatePath("manager") });

test("manager creates a second model through the UI (model.create)", async ({ page }) => {
  await page.goto("/models");
  const name = e2eName("M2");
  if (await page.getByText(name, { exact: true }).count()) return; // re-run
  await page.getByRole("button", { name: "New model" }).click();
  await page.locator("#model-stage-name").fill(name);
  await page.locator("#model-legal-name").fill("E2E Test Model Two (test fixture)");
  await page.locator("#model-dob").fill("1996-02-02");
  await page.locator("#model-commission").fill("60");
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
});

test("manager creates platform, account and operator assignment", async ({ page }) => {
  const { modelId, operatorId } = readRun();
  const platformName = e2eName("PLAT");
  const db = serviceDb();

  // Cell-scoped assertions: the bare text also appears inside hidden <option>
  // elements of the account form's selects, which strict-visibility trips over.
  await page.goto("/platforms");
  if (!(await page.getByRole("cell", { name: platformName, exact: true }).count())) {
    await page.getByRole("button", { name: "New platform" }).click();
    await page.locator("#platform-name").fill(platformName);
    await page.getByRole("button", { name: "Add platform" }).click();
    await expect(page.getByRole("cell", { name: platformName, exact: true }).first()).toBeVisible();
  }

  const username = "e2e_m1_account";
  const { data: preAccount } = await db
    .from("platform_accounts")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (!preAccount) {
    await page.getByRole("button", { name: "New account" }).click();
    await selectByLabel(page, "account-model", "E2E-M1");
    await selectByLabel(page, "account-platform", platformName);
    await page.locator("#account-username").fill(username);
    await page.getByRole("button", { name: "Add account" }).click();
    // The new row renders in the page's Accounts TAB, not the default Platforms tab.
    await page.getByRole("tab", { name: /accounts/i }).click();
    await expect(page.getByRole("cell", { name: username, exact: true }).first()).toBeVisible();
  }

  const { data: account } = await db
    .from("platform_accounts")
    .select("id, status")
    .eq("username", username)
    .single();
  expect(account?.id).toBeTruthy();
  if (account!.status !== "active") {
    // Revive the fixture a previous run's cleanup closed.
    await db.from("platform_accounts").update({ status: "active" }).eq("id", account!.id);
  }
  writeRun({ platformAccountId: account!.id });

  // Operator joins E2E-M1's pool at 100% — assignments are per MODEL
  // (operator_assignments.model_id), created on the operator's page.
  const { data: existing } = await db
    .from("operator_assignments")
    .select("id")
    .eq("operator_id", operatorId)
    .eq("model_id", modelId)
    .maybeSingle();
  if (!existing) {
    await page.goto(`/operators/${operatorId}`);
    await page.getByRole("button", { name: "New assignment" }).first().click();
    await page.locator("#assignment-model").selectOption({ label: "E2E-M1" });
    await page.locator("#assignment-share").fill("100");
    await page.locator("#assignment-from").fill("2026-08-01"); // before the test period
    await page.getByRole("button", { name: "Create assignment" }).click();

    await expect
      .poll(async () => {
        const { data: created } = await db
          .from("operator_assignments")
          .select("pool_share_percent")
          .eq("operator_id", operatorId)
          .eq("model_id", modelId)
          .maybeSingle();
        return created ? Number(created.pool_share_percent) : null;
      })
      .toBe(100);
  }
});

test("manager records the statement-period earning", async ({ page }) => {
  const { platformAccountId } = readRun();
  const db = serviceDb();
  const { data: existing } = await db
    .from("earnings")
    .select("id")
    .eq("platform_account_id", platformAccountId)
    .eq("period_start", PERIOD_START)
    .eq("period_end", PERIOD_END)
    .maybeSingle();
  if (existing) {
    writeRun({ earningId: existing.id });
    return;
  }

  await page.goto("/earnings");
  await page.getByRole("button", { name: "Record statement" }).click();
  await selectByLabel(page, "earning-model", "E2E-M1");
  // The account picker enables (and populates) only after the model is chosen.
  await page.locator("#earning-account").selectOption(platformAccountId);
  await page.locator("#earning-period-start").fill(PERIOD_START);
  await page.locator("#earning-period-end").fill(PERIOD_END);
  await page.locator("#earning-gross").fill(GROSS);
  await page.locator("#earning-net").fill(NET);
  await page.getByRole("button", { name: /add|record|save/i }).last().click();

  // The dialog also renders "$1,000.00", so the DB is the completion signal.
  let earningId: string | null = null;
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("earnings")
          .select("id")
          .eq("platform_account_id", platformAccountId)
          .eq("period_start", PERIOD_START)
          .eq("period_end", PERIOD_END)
          .maybeSingle();
        earningId = data?.id ?? null;
        return earningId;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
  writeRun({ earningId: earningId! });
});

test.describe("close period as finance", () => {
  test.use({ storageState: storageStatePath("finance") });

  test("close posts shares that reconcile to the cent", async ({ page }) => {
    const { earningId, modelId, operatorId } = readRun();
    const db = serviceDb();

    // Skip-proof: if a prior run already posted, this close must post 0 for
    // OUR earning; the idempotency test below still holds.
    const { data: before } = await db
      .from("ledger_entries")
      .select("id")
      .eq("earning_id", earningId);
    const alreadyPosted = (before?.length ?? 0) > 0;

    await page.goto("/ledger");
    await page.getByRole("button", { name: "Close period" }).click();
    await page.locator("#close-start").fill(PERIOD_START);
    await page.locator("#close-end").fill(PERIOD_END);
    await page.getByRole("button", { name: "Run share generation" }).click();
    await expect(page.getByText(/shares? posted/i).first()).toBeVisible({ timeout: 30_000 });

    const { data: entries } = await db
      .from("ledger_entries")
      .select("payee_type, payee_id, entry_type, amount")
      .eq("earning_id", earningId)
      .eq("entry_type", "earning_share");
    expect(entries?.length).toBe(2);

    const modelEntry = entries!.find((e) => e.payee_type === "model");
    const operatorEntry = entries!.find((e) => e.payee_type === "operator");
    expect(modelEntry?.payee_id).toBe(modelId);
    expect(Number(modelEntry?.amount)).toBe(EXPECTED_MODEL_SHARE);
    expect(operatorEntry?.payee_id).toBe(operatorId);
    expect(Number(operatorEntry?.amount)).toBe(EXPECTED_OPERATOR_SHARE);

    // v_payee_balances reconciles: balance delta for the model payee includes
    // exactly the posted credit (cent-exact, no floating residue).
    const { data: balance } = await db
      .from("v_payee_balances")
      .select("balance")
      .eq("payee_type", "model")
      .eq("payee_id", modelId!)
      .single();
    expect(balance).toBeTruthy();
    const cents = Number(balance!.balance) * 100;
    expect(Math.abs(cents - Math.round(cents))).toBeLessThan(1e-6); // cent-exact
    if (!alreadyPosted) {
      expect(Number(balance!.balance)).toBeGreaterThanOrEqual(EXPECTED_MODEL_SHARE);
    }
  });

  test("re-running the same close is idempotent (0 posted)", async ({ page }) => {
    const { earningId } = readRun();
    const db = serviceDb();
    const { data: before } = await db.from("ledger_entries").select("id").eq("earning_id", earningId);

    await page.goto("/ledger");
    await page.getByRole("button", { name: "Close period" }).click();
    await page.locator("#close-start").fill(PERIOD_START);
    await page.locator("#close-end").fill(PERIOD_END);
    await page.getByRole("button", { name: "Run share generation" }).click();
    await expect(page.getByText(/0 shares? posted/i).first()).toBeVisible({ timeout: 30_000 });

    const { data: after } = await db.from("ledger_entries").select("id").eq("earning_id", earningId);
    expect(after?.length).toBe(before?.length);
  });
});
