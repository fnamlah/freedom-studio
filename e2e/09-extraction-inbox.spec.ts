import { expect, test } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { pinEnglish } from "./helpers/session";
import { readUsers, storageStatePath } from "./helpers/state";

/**
 * Scenario 9 — the document analyzer's review inbox (021): rows the AI read
 * out of an uploaded file become business records ONLY after a human reviews
 * and applies them on /documents/inbox.
 *
 * The AI crossing itself is exercised by 05 (classification); this spec seeds
 * `doc_extractions` directly — the staging row IS the contract between the
 * crossing and the inbox — and proves the human half end-to-end as manager:
 *
 *   • an unresolved row (username the studio doesn't have) blocks Apply until
 *     an account is picked — the inbox never guesses;
 *   • Apply creates `earnings` rows with `source='import'` (the entry_source
 *     value reserved since 001), `model_id` derived from the account;
 *   • re-applying the same statement is idempotent: every row reports as
 *     already recorded, nothing doubles;
 *   • Dismiss parks a proposal without writing anything.
 *
 * Fully self-cleaning: fixtures are created by this spec and hard-deleted in
 * afterAll (earnings first, then account → platform → model — no ledger rows
 * are ever produced here, so nothing append-only is touched).
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("manager") });

const STAMP = Date.now();
const PLATFORM = `E2E-INBOX-PLAT-${STAMP}`;
const MODEL_STAGE = `E2E-INBOX-M-${STAMP}`;
const USERNAME = `e2e_inbox_${STAMP}`;
const FILE_A = `e2e-inbox-statement-${STAMP}.pdf`;
const FILE_B = `e2e-inbox-statement-b-${STAMP}.pdf`;
const FILE_C = `e2e-inbox-receipt-${STAMP}.pdf`;

const ROWS = [
  {
    platform: PLATFORM,
    username: USERNAME, // resolves — exactly one account carries it
    period_start: "2026-07-01",
    period_end: "2026-07-07",
    gross_amount: 1000,
    fee_amount: 100,
    net_amount: 900,
    currency: "USD",
  },
  {
    platform: PLATFORM,
    username: `stranger_${STAMP}`, // resolves to nothing — reviewer must pick
    period_start: "2026-07-08",
    period_end: "2026-07-14",
    gross_amount: 500,
    fee_amount: 0,
    net_amount: 500,
    currency: "USD",
  },
];

const ids = {
  modelId: "",
  platformId: "",
  accountId: "",
  fileA: "",
  fileB: "",
  fileC: "",
};

async function seedFile(name: string): Promise<string> {
  const db = serviceDb();
  const { data, error } = await db
    .from("library_files")
    .insert({
      name,
      storage_path: `e2e-inbox/${name}`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      ai_status: "suggested",
      uploaded_by: readUsers().manager!.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function seedProposal(
  sourceId: string,
  kind: "earnings" | "expenses",
  payload: unknown,
): Promise<void> {
  const db = serviceDb();
  const { error } = await db.from("doc_extractions").insert({
    source_kind: "library_file",
    source_id: sourceId,
    kind,
    payload: payload as never,
    confidence: 0.91,
    created_by: readUsers().manager!.userId,
  });
  if (error) throw error;
}

test.beforeAll(async () => {
  const db = serviceDb();
  const createdBy = readUsers().manager!.userId;

  const { data: model, error: modelErr } = await db
    .from("models")
    .insert({
      stage_name: MODEL_STAGE,
      legal_name: "E2E Inbox Model (test fixture)",
      date_of_birth: "1995-05-05",
      commission_percent: 60,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (modelErr) throw modelErr;
  ids.modelId = model.id;

  // `platforms` carries no created_by column — it is studio-global vocabulary.
  const { data: platform, error: platformErr } = await db
    .from("platforms")
    .insert({ name: PLATFORM })
    .select("id")
    .single();
  if (platformErr) throw platformErr;
  ids.platformId = platform.id;

  // `platform_accounts` carries no created_by either (002).
  const { data: account, error: accountErr } = await db
    .from("platform_accounts")
    .insert({
      model_id: ids.modelId,
      platform_id: ids.platformId,
      username: USERNAME,
    })
    .select("id")
    .single();
  if (accountErr) throw accountErr;
  ids.accountId = account.id;

  ids.fileA = await seedFile(FILE_A);
  await seedProposal(ids.fileA, "earnings", { rows: ROWS });
});

test("an unresolved row blocks Apply until the reviewer picks an account", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/documents/inbox");

  const card = page.locator("section").filter({ hasText: FILE_A });
  await expect(card.getByText("Earnings statement")).toBeVisible();

  // Row 1 resolved itself from what the statement printed; row 2 did not.
  await expect(card.getByText(`Printed on the document: ${PLATFORM} · ${USERNAME}`)).toBeVisible();
  await expect(card.getByText(/matched no account/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Apply" })).toBeDisabled();

  // The reviewer decides — the second select gets the account by hand.
  await card
    .getByRole("combobox", { name: "Account" })
    .nth(1)
    .selectOption({ label: `${MODEL_STAGE} · ${PLATFORM} (@${USERNAME})` });
  await expect(card.getByRole("button", { name: "Apply" })).toBeEnabled();
});

test("Apply records the rows as earnings with source='import'", async ({ page }) => {
  await pinEnglish(page);
  await page.goto("/documents/inbox");

  const card = page.locator("section").filter({ hasText: FILE_A });
  await card
    .getByRole("combobox", { name: "Account" })
    .nth(1)
    .selectOption({ label: `${MODEL_STAGE} · ${PLATFORM} (@${USERNAME})` });
  await card.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("Recorded: 2.")).toBeVisible();

  const db = serviceDb();
  const { data: earnings } = await db
    .from("earnings")
    .select("source, model_id, platform_account_id, net_amount, entered_by")
    .eq("platform_account_id", ids.accountId)
    .order("period_start");

  expect(earnings).toHaveLength(2);
  for (const row of earnings!) {
    expect(row.source).toBe("import");
    // The account decided the model — server-side, never client-supplied.
    expect(row.model_id).toBe(ids.modelId);
    expect(row.entered_by).toBe(readUsers().manager!.userId);
  }
  expect(earnings!.map((e) => Number(e.net_amount))).toEqual([900, 500]);

  const { data: extraction } = await db
    .from("doc_extractions")
    .select("state, reviewed_by, result")
    .eq("source_id", ids.fileA)
    .single();
  expect(extraction!.state).toBe("applied");
  expect(extraction!.reviewed_by).toBe(readUsers().manager!.userId);
});

test("re-applying the same statement is idempotent — nothing doubles", async ({ page }) => {
  // A fresh proposal for the SAME rows (a re-uploaded copy of the statement).
  ids.fileB = await seedFile(FILE_B);
  await seedProposal(ids.fileB, "earnings", {
    rows: ROWS.map((r) => ({ ...r, username: USERNAME })),
  });

  await pinEnglish(page);
  await page.goto("/documents/inbox");

  const card = page.locator("section").filter({ hasText: FILE_B });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/already (been )?recorded/)).toBeVisible();

  const db = serviceDb();
  const { count } = await db
    .from("earnings")
    .select("id", { count: "exact", head: true })
    .eq("platform_account_id", ids.accountId);
  expect(count).toBe(2); // still two — earnings_stmt_unique held
});

test("Dismiss parks a proposal without writing anything", async ({ page }) => {
  ids.fileC = await seedFile(FILE_C);
  await seedProposal(ids.fileC, "expenses", {
    rows: [
      {
        incurred_on: "2026-07-03",
        vendor: `E2E Vendor ${STAMP}`,
        amount: 49.99,
        currency: "USD",
      },
    ],
  });

  await pinEnglish(page);
  await page.goto("/documents/inbox");

  const card = page.locator("section").filter({ hasText: FILE_C });
  await expect(card.getByText("Expense")).toBeVisible();
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Proposal dismissed.")).toBeVisible();
  await expect(page.locator("section").filter({ hasText: FILE_C })).toHaveCount(0);

  const db = serviceDb();
  const { data } = await db
    .from("doc_extractions")
    .select("state")
    .eq("source_id", ids.fileC)
    .single();
  expect(data!.state).toBe("dismissed");
  const { count } = await db
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("vendor", `E2E Vendor ${STAMP}`);
  expect(count).toBe(0);
});

test.afterAll(async () => {
  const db = serviceDb();
  // Order matters: earnings reference the account; extractions/files first is
  // harmless. No ledger rows were produced, so everything hard-deletes.
  for (const fileId of [ids.fileA, ids.fileB, ids.fileC].filter(Boolean)) {
    await db.from("doc_extractions").delete().eq("source_id", fileId);
    await db.from("library_files").delete().eq("id", fileId);
  }
  if (ids.accountId) {
    await db.from("earnings").delete().eq("platform_account_id", ids.accountId);
    await db.from("platform_accounts").delete().eq("id", ids.accountId);
  }
  if (ids.platformId) await db.from("platforms").delete().eq("id", ids.platformId);
  if (ids.modelId) await db.from("models").delete().eq("id", ids.modelId);
});
