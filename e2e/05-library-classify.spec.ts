import { expect, test, type Page } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { optionalEnv } from "./helpers/env";
import { makePdf, makePng } from "./helpers/fixtures";
import { e2eName } from "./helpers/naming";
import { storageStatePath, writeRun } from "./helpers/state";

/**
 * Scenario 6 — library + AI classification: upload → classify → review queue →
 * confirm/override, and the two hard NEGATIVES: an `ai_exempt` file and a file
 * filed under the `identity` category (ai_enabled=false) must never cross to
 * the provider — no suggestion, no `ai_usage` metering, no `ai.classify`
 * crossing — while a sibling file in the SAME batch does (positive control).
 *
 * Without a provider key the suite still runs: classify surfaces
 * "not configured" and every file stays pending (also asserted).
 */

test.describe.configure({ mode: "serial" });

const CONTROL = e2eName("LIB tax-receipt.pdf");
const EXEMPT = e2eName("LIB exempt.pdf");
const IDENTITY = e2eName("LIB identity-scan.png");

const aiConfigured = Boolean(optionalEnv("MOONSHOT_API_KEY") || optionalEnv("ZHIPU_API_KEY"));

test.use({ storageState: storageStatePath("manager") });

async function uploadLibraryFile(
  page: Page,
  opts: { file: string; name: string; category?: string; exempt?: boolean },
): Promise<void> {
  await page.goto("/library");
  await page.getByRole("button", { name: "Upload file" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#lib-folder").fill("/e2e");
  await dialog.locator("#lib-name").fill(opts.name);
  if (opts.category) {
    await dialog.locator("#lib-category").selectOption({ label: opts.category });
  }
  if (opts.exempt) {
    await dialog.locator('input[type="checkbox"]').check();
  }
  await dialog.locator("#lib-file").setInputFiles(opts.file);
  await dialog.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText(opts.name).first()).toBeVisible({ timeout: 30_000 });
}

async function fileRow(name: string) {
  const { data } = await serviceDb()
    .from("library_files")
    .select("id, ai_status, ai_exempt, ai_suggested_category_id, category_id")
    .eq("name", name)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

test("manager uploads control, exempt, and identity-category files", async ({ page }) => {
  await uploadLibraryFile(page, { file: makePdf("E2E tax receipt 2026 total 42.00"), name: CONTROL });
  await uploadLibraryFile(page, { file: makePdf("E2E exempt content"), name: EXEMPT, exempt: true });
  await uploadLibraryFile(page, {
    file: makePng(),
    name: IDENTITY,
    // The picker annotates ai_enabled=false categories with "(AI off)".
    category: "Identity documents (AI off)",
  });

  const control = await fileRow(CONTROL);
  const exempt = await fileRow(EXEMPT);
  const identity = await fileRow(IDENTITY);
  expect(control?.ai_status).toBe("pending");
  expect(exempt?.ai_exempt).toBe(true);
  expect(identity?.category_id).toBeTruthy();
  writeRun({
    libControlId: control!.id,
    libExemptId: exempt!.id,
    libIdentityId: identity!.id,
  });
});

test("classification batch: control crosses, exempt and identity never do", async ({
  page,
}) => {
  const before = await serviceDb()
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("request_kind", "classify");

  await page.goto("/library");
  await page.getByRole("button", { name: /classify all pending/i }).click();

  if (!aiConfigured) {
    await expect(page.getByText(/not configured/i).first()).toBeVisible({ timeout: 30_000 });
    const control = await fileRow(CONTROL);
    expect(control?.ai_status).toBe("pending"); // nothing moved, nothing crossed
    return;
  }

  // Wait for the batch to finish (button label returns from "Classifying…").
  await expect(page.getByRole("button", { name: /classify all pending/i })).toBeEnabled({
    timeout: 120_000,
  });

  const control = await fileRow(CONTROL);
  const exempt = await fileRow(EXEMPT);
  const identity = await fileRow(IDENTITY);

  // Positive control: crossed and suggested (or failed with metering if the
  // provider misbehaved — but never silently pending).
  expect(control?.ai_status).toBe("suggested");
  expect(control?.ai_suggested_category_id).toBeTruthy();

  // The exempt file must never cross: depending on the batch path it stays
  // "pending" (never selected) or is explicitly refused as "skipped" — either
  // way no suggestion may exist, and the metering delta below proves no
  // provider crossing happened.
  expect(["pending", "skipped"]).toContain(exempt?.ai_status);
  expect(exempt?.ai_suggested_category_id ?? null).toBeNull();
  // The identity-category file is selected, then refused at the carve-out.
  expect(identity?.ai_status).toBe("skipped");
  expect(identity?.ai_suggested_category_id).toBeNull();

  // Metering: exactly the control file crossed.
  const after = await serviceDb()
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("request_kind", "classify");
  expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);
});

test("review queue: confirm writes the category + audit row", async ({ page }) => {
  test.skip(!aiConfigured, "no provider key — no suggestions to review");

  await page.goto("/library");
  await page.getByRole("tab", { name: /review/i }).click();
  await expect(page.getByText(CONTROL).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm suggestion" }).first().click();

  // The database is the oracle (the queue list can lag a router.refresh);
  // a hard reload then proves the UI converged.
  await expect
    .poll(async () => (await fileRow(CONTROL))?.ai_status, { timeout: 20_000 })
    .toBe("confirmed");
  await page.reload();
  await page.getByRole("tab", { name: /review/i }).click();
  await expect(page.getByRole("tabpanel").getByText(CONTROL)).toHaveCount(0);

  const control = await fileRow(CONTROL);
  expect(control?.ai_status).toBe("confirmed");
  expect(control?.category_id).toBe(control?.ai_suggested_category_id);

  const { data: audits } = await serviceDb()
    .from("audit_log")
    .select("action, entity_id")
    .eq("action", "library.categorize")
    .eq("entity_id", control!.id);
  expect(audits?.length).toBeGreaterThanOrEqual(1);
});
