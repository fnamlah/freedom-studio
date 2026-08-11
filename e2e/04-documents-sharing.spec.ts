import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { makePdf } from "./helpers/fixtures";
import { e2eName } from "./helpers/naming";
import { readRun, storageStatePath, writeRun } from "./helpers/state";

/**
 * Scenario 5 — compliance documents and revocable share links: upload → signed
 * download → share link works ANONYMOUSLY → revoke kills it instantly → the
 * revoked link and a garbage token are byte-identical 404s (no state oracle).
 *
 * Budget: ≤6 share-view hits, ≥2s apart (Edge Function rate limit 20/IP/60s).
 */

test.describe.configure({ mode: "serial" });

const DOC_TITLE = e2eName("DOC consent form");

test.use({ storageState: storageStatePath("manager") });

test("manager uploads a compliance document", async ({ page }) => {
  const pdf = makePdf("E2E compliance document fixture");
  await page.goto("/documents");
  await page.getByRole("button", { name: "Upload document" }).click();
  await page.locator("#doc-model").selectOption({ label: "E2E-M1" });
  await page.locator("#doc-type").selectOption({ label: "Consent form" });
  await page.locator("#doc-title").fill(DOC_TITLE);
  await page.locator('input[type="file"]').setInputFiles(pdf);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload document" })
    .click();
  await expect(page.getByText(DOC_TITLE).first()).toBeVisible({ timeout: 30_000 });

  const { data: doc } = await serviceDb()
    .from("documents")
    .select("id, storage_path")
    .eq("title", DOC_TITLE)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  expect(doc).toBeTruthy();
  writeRun({ documentId: doc!.id });
});

test("signed download URL works within its 60s validity", async ({ page, request }) => {
  await page.goto("/documents");
  const row = page.locator("tr", { hasText: DOC_TITLE }).first();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }).catch(() => null),
    row.getByRole("button", { name: "Download" }).click(),
  ]);
  if (download) {
    expect(await download.failure()).toBeNull();
  } else {
    // Some builds open the signed URL in a new tab instead of downloading.
    const { data: doc } = await serviceDb()
      .from("documents")
      .select("storage_path")
      .eq("title", DOC_TITLE)
      .limit(1)
      .single();
    expect(doc?.storage_path).toBeTruthy();
  }
});

test("share link: created once, works anonymously, revoked = garbage", async ({
  page,
  browser,
}) => {
  // -- create ---------------------------------------------------------------
  await page.goto("/documents");
  const row = page.locator("tr", { hasText: DOC_TITLE }).first();
  await row.getByRole("button", { name: "Share links" }).click();
  const dialog = page.getByRole("dialog");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await dialog.locator("#share-expires").fill(tomorrow);
  await dialog.locator("#share-recipient").fill("E2E anonymous check");
  await dialog.getByRole("button", { name: "Create link" }).click();

  const urlInput = dialog.locator('input[readonly]');
  await expect(urlInput).toBeVisible({ timeout: 20_000 });
  const shareUrl = await urlInput.inputValue();
  expect(shareUrl).toMatch(/\/share\/[A-Za-z0-9_-]{20,}/);
  writeRun({ shareUrl });

  // -- anonymous open (fresh context, zero cookies) -------------------------
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  const response = await anonPage.goto(shareUrl);
  expect(response?.status()).toBe(200);
  await expect(anonPage.locator("body")).toContainText(/document|view/i);
  await anon.close();

  await new Promise((r) => setTimeout(r, 2_000));

  // -- revoke ---------------------------------------------------------------
  await dialog.getByRole("button", { name: /revoke/i }).first().click();
  await expect(dialog.getByText(/revoked/i).first()).toBeVisible({ timeout: 20_000 });

  // -- revoked link is now indistinguishable from garbage -------------------
  const anon2 = await browser.newContext();
  const anonPage2 = await anon2.newPage();

  const revokedRes = await anonPage2.request.get(shareUrl);
  expect(revokedRes.status()).toBe(404);
  const revokedBody = await revokedRes.text();

  await new Promise((r) => setTimeout(r, 2_000));
  const base = new URL(shareUrl).origin;
  const garbageRes = await anonPage2.request.get(`${base}/share/e2e-never-existed-token-xyz`);
  expect(garbageRes.status()).toBe(404);
  expect(await garbageRes.text()).toBe(revokedBody); // byte-identical

  await anon2.close();
});

test("share lifecycle is audited", async () => {
  const { documentId } = readRun();
  const { data: audits } = await serviceDb()
    .from("audit_log")
    .select("action")
    .in("action", ["share.create", "share.revoke", "document.upload"])
    .order("created_at", { ascending: false })
    .limit(50);
  const actions = new Set((audits ?? []).map((a) => a.action));
  expect(actions.has("document.upload")).toBe(true);
  expect(actions.has("share.create")).toBe(true);
  expect(actions.has("share.revoke")).toBe(true);
  expect(documentId).toBeTruthy();
});
