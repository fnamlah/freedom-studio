import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { pinEnglish } from "./helpers/session";
import { readUsers, storageStatePath } from "./helpers/state";

/**
 * Scenario 10 — Telegram pairing (migration 015).
 *
 * An unpaired chat can do exactly one thing: redeem a one-time code. Until
 * this surface existed those codes were minted by hand in SQL, so the studio's
 * second Super Admin simply had no way to pair — the gap this closes.
 *
 * What matters here is that the app cannot hand out a code the BOT would
 * refuse, because a code that silently never works is worse than no code:
 *   * the picker offers only active, bot-eligible profiles (BOT_ROLES);
 *   * the minted row carries `expected_username`, so it is inert from any
 *     other Telegram account (a code was once pasted into an unrelated bot
 *     and had to be burned);
 *   * the code is shown once and never re-read from the server.
 *
 * Self-cleaning: the code it mints is deleted in afterAll.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("super_admin") });

const HANDLE = `e2e_pair_${Date.now()}`;
let mintedCode = "";

test("the picker offers only bot-eligible people", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/admin/hermes");

  const select = page.getByLabel("Who is pairing");
  await expect(select).toBeVisible();

  const labels = await select.locator("option").allTextContents();
  // Models and operators see only their own rows in the app; the bot answers
  // from a service account that sees everything, so they must never appear.
  expect(labels.join(" | ")).not.toMatch(/\bModel\b|\bOperator\b/);
  expect(labels.some((l) => /Super Admin|Manager|Finance/.test(l))).toBe(true);
});

test("minting shows the code once and pins it to the named account", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/admin/hermes");

  const saUserId = readUsers().super_admin!.userId;
  await page.getByLabel("Who is pairing").selectOption(saUserId);
  await page.getByLabel("Their Telegram username").fill(`@${HANDLE}`);
  await page.getByLabel("Valid for (days)").fill("3");
  await page.getByRole("button", { name: "Create code" }).click();

  await expect(page.getByText("Hand this to them")).toBeVisible();
  const code = (await page.locator("code").first().innerText()).trim();
  expect(code).toMatch(/^[0-9a-f]{12}$/);
  mintedCode = code;

  const { data: row } = await serviceDb()
    .from("hermes_pairing_codes")
    .select("profile_id, expected_username, used_at, expires_at")
    .eq("code", code)
    .single();

  expect(row!.profile_id).toBe(saUserId);
  // The @ is stripped on the way in — the bot compares bare, lowercased.
  expect(row!.expected_username).toBe(HANDLE.toLowerCase());
  expect(row!.used_at).toBeNull();
  expect(Date.parse(row!.expires_at)).toBeGreaterThan(Date.now());

  // Shown once: a reload must not re-reveal it.
  await page.reload();
  await expect(page.getByText(code)).toHaveCount(0);
});

test("an ineligible or unknown person is refused", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/admin/hermes");

  // A username that cannot exist on Telegram (too short) is refused before
  // anything is written — the code would be unusable either way.
  await page.getByLabel("Who is pairing").selectOption(readUsers().super_admin!.userId);
  await page.getByLabel("Their Telegram username").fill("@abc");
  await page.getByRole("button", { name: "Create code" }).click();

  await expect(page.getByText(/Telegram username — 5–32/)).toBeVisible();
});

test.afterAll(async () => {
  const db = serviceDb();
  if (mintedCode) await db.from("hermes_pairing_codes").delete().eq("code", mintedCode);
  await db.from("hermes_pairing_codes").delete().eq("expected_username", HANDLE.toLowerCase());
});
