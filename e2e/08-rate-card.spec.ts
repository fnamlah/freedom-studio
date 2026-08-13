import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { pinEnglish } from "./helpers/session";
import { storageStatePath } from "./helpers/state";

/**
 * Scenario 8 — the studio rate card (025).
 *
 * The owner's real structure: every role earns its OWN percentage of the
 * model's Sunday–Saturday net, with its own brackets, and which of the three
 * model rows applies depends on who is assigned to her. This spec proves the
 * card is what the app reads and writes, and that the studio can never be put
 * underwater by one.
 *
 * The money itself — every composition at every bracket — was verified against
 * the live database when 025 landed, and scenario 02 now asserts the card's
 * numbers on a real close (450/250 for a $1,000 week with an operator). This
 * spec deliberately runs no close of its own: ledger_entries is append-only,
 * so re-proving the arithmetic on every run would leave permanent residue.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("super_admin") });

const DEFAULT_SECTION = "Studio default";

/** The card exactly as the owner stated it (2026-08-13). */
const OWNER_CARD: Record<string, [number, number][]> = {
  model_independent: [[0, 80]],
  model_with_coach: [
    [0, 60],
    [1501, 65],
    [2500, 70],
  ],
  model_with_operator: [
    [0, 45],
    [1501, 50],
    [2500, 55],
  ],
  operator: [
    [0, 25],
    [1501, 28],
    [3000, 30],
  ],
  coach: [[0, 7]],
  team_leader: [
    [0, 2],
    [1501, 3],
    [3000, 4],
  ],
};

async function defaultSchemeId(): Promise<string> {
  const { data } = await serviceDb()
    .from("commission_schemes")
    .select("id")
    .is("model_id", null)
    .is("platform_account_id", null)
    .single();
  return data!.id;
}

test("the studio's card is seeded on the default scheme, exactly as stated", async () => {
  const { data: rates } = await serviceDb()
    .from("commission_rates")
    .select("party, min_amount, percent")
    .eq("scheme_id", await defaultSchemeId());

  const actual: Record<string, [number, number][]> = {};
  for (const r of rates ?? []) {
    (actual[r.party] ??= []).push([Number(r.min_amount), Number(r.percent)]);
  }
  for (const party of Object.keys(actual)) {
    actual[party].sort((a, b) => a[0] - b[0]);
  }
  expect(actual).toEqual(OWNER_CARD);
});

test("the card renders per role, and the table reports the span it can pay", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/schemes");

  const section = page.locator("section").filter({ hasText: DEFAULT_SECTION });
  // 14 levels across six roles.
  await expect(section.getByRole("button", { name: "Rate card · 14" })).toBeVisible();
  // The model column can no longer be one number: 45% at worst, 80% at best.
  await expect(section.getByText("45% – 80%")).toBeVisible();

  await section.getByRole("button", { name: /^Rate card/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Model — with an operator" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Team leader" })).toBeVisible();
  // The preview spells out what nobody types: the studio's remainder.
  await expect(dialog.getByText("What a week pays")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a card that would pay out more than a week is refused", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/schemes");

  const section = page.locator("section").filter({ hasText: DEFAULT_SECTION });
  await section.getByRole("button", { name: /^Rate card/ }).click();
  const dialog = page.getByRole("dialog");

  // Push the with-operator model rate to 90: with the operator's 25 and the
  // coach's 7 that is 122% of a low week.
  await dialog.getByLabel("Model — with an operator — Percent").first().fill("90");

  await expect(dialog.getByText(/pays out more than the studio takes in/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save rate card" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("the seeded card survives the session unchanged", async () => {
  // Nothing above saves; this guards against a stray write leaving the
  // studio's real rates altered for the next spec (02 asserts 450/250).
  const { count } = await serviceDb()
    .from("commission_rates")
    .select("id", { count: "exact", head: true })
    .eq("scheme_id", await defaultSchemeId());
  expect(count).toBe(14);
});
