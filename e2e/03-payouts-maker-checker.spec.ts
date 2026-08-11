import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { dbAs } from "./helpers/db";
import { readRun, storageStatePath, writeRun } from "./helpers/state";

/**
 * Scenario 4 — maker-checker: finance creates the payout, finance CANNOT
 * approve (asserted in the UI and as a direct RLS write probe), only
 * super_admin approves, finance settles, and the settlement ledger entry is
 * posted by the DB trigger — bringing the payee balance back toward zero.
 */

test.describe.configure({ mode: "serial" });

const PERIOD_START = "2026-08-10";
const PERIOD_END = "2026-08-11";

async function modelBalance(modelId: string): Promise<number> {
  const { data } = await serviceDb()
    .from("v_payee_balances")
    .select("balance")
    .eq("payee_type", "model")
    .eq("payee_id", modelId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

test.describe("finance creates", () => {
  test.use({ storageState: storageStatePath("finance") });

  test("finance creates a pending payout for the model's full balance", async ({ page }) => {
    const { modelId } = readRun();

    // Fixture pre-clean: failed earlier runs can leave stale pending payouts;
    // with duplicates, the approve step below could target the wrong row.
    // pending → cancelled is a legal transition the trigger permits.
    await serviceDb()
      .from("payouts")
      .update({ status: "cancelled" })
      .eq("payee_type", "model")
      .eq("payee_id", modelId)
      .in("status", ["pending", "approved"]);

    const balance = await modelBalance(modelId);
    expect(balance).toBeGreaterThan(0); // scenario 3 posted credits

    await page.goto("/payouts");
    await page.getByRole("button", { name: "Create payout" }).click();
    await page.locator("#payout-payee").selectOption(`model:${modelId}`);
    await page.locator("#payout-start").fill(PERIOD_START);
    await page.locator("#payout-end").fill(PERIOD_END);
    await page.locator("#payout-gross").fill(String(balance));
    await page.locator("#payout-net").fill(String(balance));
    await page.getByRole("button", { name: /create/i }).last().click();

    // The stat tiles also say "Pending" — the DB row is the completion signal.
    let payout: { id: string; net_amount: string } | null = null;
    await expect
      .poll(
        async () => {
          const { data } = await serviceDb()
            .from("payouts")
            .select("id, net_amount")
            .eq("payee_type", "model")
            .eq("payee_id", modelId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          payout = data ?? null;
          return payout?.id ?? null;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
    expect(Number(payout!.net_amount)).toBe(balance);
    writeRun({ payoutId: payout!.id, payoutAmount: String(balance) });
  });

  test("finance sees no Approve control on the pending payout", async ({ page }) => {
    await page.goto("/payouts");
    // Scope to the table: the (hidden) create dialog's copy also says "pending".
    await expect(page.locator("table").getByText("Pending", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("finance cannot approve at the database boundary (0 rows)", async () => {
    const { payoutId } = readRun();
    const db = dbAs("finance");
    const { data, error } = await db
      .from("payouts")
      .update({ status: "approved" })
      .eq("id", payoutId)
      .select("id");
    if (error) {
      expect(error.message).toBeTruthy(); // explicit RLS refusal is fine
    } else {
      expect(data).toEqual([]); // silent 0-row update is the standard RLS shape
    }
    const { data: check } = await serviceDb()
      .from("payouts")
      .select("status")
      .eq("id", payoutId)
      .single();
    expect(check?.status).toBe("pending"); // unchanged
  });
});

test.describe("super admin approves", () => {
  test.use({ storageState: storageStatePath("super_admin") });

  test("super admin approves the payout", async ({ page }) => {
    const { payoutId } = readRun();
    await page.goto("/payouts");
    await page.getByRole("button", { name: "Approve" }).first().click();
    // Confirmation dialog: "Approve this payout?"
    await page.getByRole("dialog").getByRole("button", { name: /approve/i }).click();

    // Stat tiles also read "Approved" — poll the DB for the real transition.
    await expect
      .poll(
        async () => {
          const { data } = await serviceDb()
            .from("payouts")
            .select("status")
            .eq("id", payoutId)
            .single();
          return data?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("approved");
  });
});

test.describe("finance settles", () => {
  test.use({ storageState: storageStatePath("finance") });

  test("marking paid auto-posts the settlement entry and zeroes the balance", async ({
    page,
  }) => {
    const { payoutId, modelId, payoutAmount } = readRun();
    const before = await modelBalance(modelId);

    await page.goto("/payouts");
    await page.getByRole("button", { name: /mark paid|record settlement|settle/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(`#paid-ref-${payoutId}`).fill("E2E-TXN-0001");
    await dialog.locator(`#paid-method-${payoutId}`).fill("E2E test settlement");
    await dialog.getByRole("button", { name: /mark paid|record|confirm/i }).last().click();

    // The app never posts this entry — the DB trigger does. Poll for it.
    let settlement: Array<{ entry_type: string; amount: string; payee_id: string }> = [];
    await expect
      .poll(
        async () => {
          const { data } = await serviceDb()
            .from("ledger_entries")
            .select("entry_type, amount, payee_id")
            .eq("payout_id", payoutId)
            .eq("entry_type", "payout_settlement");
          settlement = data ?? [];
          return settlement.length;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    expect(Number(settlement[0].amount)).toBe(-Number(payoutAmount));
    expect(settlement[0].payee_id).toBe(modelId);

    const after = await modelBalance(modelId);
    expect(after).toBeCloseTo(before - Number(payoutAmount), 2);
    expect(after).toBeCloseTo(0, 2); // full-balance payout → clean zero
  });
});
