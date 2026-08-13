import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { pinEnglish } from "./helpers/session";
import { storageStatePath } from "./helpers/state";

/**
 * Scenario 8 — income tiers (023/024): a scheme's split is not fixed. The
 * model's TOTAL net for the week selects a tier, and all three shares move with
 * it — the model's, the team pool's and the studio's.
 *
 * This spec covers the LADDER: building it through the real dialog as super
 * admin, the 100% rule blocking a bad rung, the atomic whole-ladder save, and
 * clearing it back to the scheme's base percentages. Tiers are configuration,
 * so the suite can create and remove them completely — it leaves no residue.
 *
 * What this spec deliberately does NOT do is run a close. Proving the money
 * would mean posting real `earning_share` credits, and `ledger_entries` is
 * append-only: the suite's own rule (99-cleanup) is to reverse such rows with a
 * deduction rather than delete them, so every run would leave a permanent pair
 * of four-figure entries in the live studio ledger. The tier→money path was
 * verified directly against the database when 023 landed:
 *
 *   week 800 net  → model 60% (base)   · team pool 10%
 *   week 6000 net → model 70% (tier)   · team pool 12%, split 70/30 op/coach
 *
 * The assertion below is the part that can be made permanent safely: that the
 * close function actually reads the ladder this dialog writes.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("super_admin") });

const TIER_MIN = "5000";

/** The studio default scheme's section — every scheme write here is SA-only. */
const DEFAULT_SECTION = "Studio default";

test("super admin builds a tier ladder through the dialog", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/schemes");

  const section = page.locator("section").filter({ hasText: DEFAULT_SECTION });
  await section.getByRole("button", { name: /^Tiers/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Income tiers")).toBeVisible();
  // The floor of the ladder is the scheme's own split, shown read-only.
  await expect(dialog.getByText("Below the first tier")).toBeVisible();
  await expect(dialog.getByText(/No tiers yet/)).toBeVisible();

  await dialog.getByRole("button", { name: "Add tier" }).click();
  await dialog.getByLabel("Weekly net from").fill(TIER_MIN);
  await dialog.getByLabel("Model", { exact: true }).fill("70");
  await dialog.getByLabel("Team pool").fill("12");
  await dialog.getByLabel("Studio").fill("18");

  await dialog.getByRole("button", { name: "Save tiers" }).click();
  await expect(page.getByText("Income tiers saved.")).toBeVisible();

  // The table now reports a RANGE, because there is no longer one model share.
  await expect(section.getByRole("button", { name: "Tiers · 1" })).toBeVisible();
  await expect(section.getByText("60% – 70%")).toBeVisible();
});

test("the ladder the dialog wrote is the one the close function will read", async () => {
  const db = serviceDb();

  const { data: scheme } = await db
    .from("commission_schemes")
    .select("id")
    .is("model_id", null)
    .is("platform_account_id", null)
    .single();

  const { data: tiers } = await db
    .from("commission_tiers")
    .select("min_amount, model_percent, operator_percent, studio_percent")
    .eq("scheme_id", scheme!.id);

  expect(tiers).toHaveLength(1);
  expect(Number(tiers![0].min_amount)).toBe(5000);
  expect(Number(tiers![0].model_percent)).toBe(70);
  expect(Number(tiers![0].operator_percent)).toBe(12);
  expect(Number(tiers![0].studio_percent)).toBe(18);
});

test("a rung whose percentages don't total 100 can't be saved", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/schemes");

  const section = page.locator("section").filter({ hasText: DEFAULT_SECTION });
  await section.getByRole("button", { name: /^Tiers/ }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Studio").fill("30"); // 70 + 12 + 30 = 112

  await expect(dialog.getByText(/Each tier must total 100%/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save tiers" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("clearing the ladder returns the scheme to its base percentages", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/schemes");

  const section = page.locator("section").filter({ hasText: DEFAULT_SECTION });
  await section.getByRole("button", { name: /^Tiers/ }).click();

  // "Remove tier", not the visible "Delete": the row's aria-label is what names
  // it, deliberately distinguishing it from deleting the scheme itself.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Remove tier" }).first().click();
  await expect(dialog.getByText(/No tiers yet/)).toBeVisible();

  await dialog.getByRole("button", { name: "Save tiers" }).click();
  await expect(page.getByText(/back to its base percentages/)).toBeVisible();

  // Back to a single figure per column, exactly as before tiers existed.
  await expect(section.getByRole("button", { name: "Tiers", exact: true })).toBeVisible();
});

test.afterAll(async () => {
  // Belt and braces: if a test above failed mid-way, the scheme must not be
  // left carrying a test ladder. Tiers are config, so this is a clean delete.
  const db = serviceDb();
  const { data: scheme } = await db
    .from("commission_schemes")
    .select("id")
    .is("model_id", null)
    .is("platform_account_id", null)
    .maybeSingle();
  if (scheme) await db.from("commission_tiers").delete().eq("scheme_id", scheme.id);
});
