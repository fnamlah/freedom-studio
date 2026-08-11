import { expect, test, type Page } from "@playwright/test";

import { serviceDb } from "./helpers/admin";
import { optionalEnv } from "./helpers/env";
import { readUsers, storageStatePath } from "./helpers/state";

/**
 * Scenario 7 — the AI assistant: gated to SA/MGR/FIN, tools run under the
 * CALLER's RLS client, usage is metered, and switching the provider is a
 * super-admin-only audited governance event (`ai.model_switch`).
 *
 * Budget: ≤3 chat messages total (limits: 30 req/user/hr).
 */

test.describe.configure({ mode: "serial" });

/**
 * Drive the provider switch: pick in #active-provider, then the page button,
 * then the dialog's confirm. A selectOption fired before React hydration
 * changes the DOM but not the state (button stays disabled) — hence the
 * re-select loop.
 */
async function switchProviderTo(page: Page, provider: string): Promise<void> {
  const switchButton = page.getByRole("button", { name: "Switch provider" });
  let enabled = false;
  for (let attempt = 0; attempt < 5 && !enabled; attempt++) {
    await page.locator("#active-provider").selectOption(provider);
    enabled = await switchButton
      .isEnabled({ timeout: 2_000 })
      .catch(() => false);
    if (!enabled) await page.waitForTimeout(1_000);
  }
  await switchButton.click();
  await page.getByRole("dialog").getByRole("button", { name: "Switch provider" }).click();
}

const aiConfigured = Boolean(optionalEnv("MOONSHOT_API_KEY") || optionalEnv("ZHIPU_API_KEY"));

test.describe("model role is outside the AI surface", () => {
  test.use({ storageState: storageStatePath("model") });

  test("model gets /forbidden on /ai and 403 from the chat API", async ({ page }) => {
    await page.goto("/ai");
    await expect(page).toHaveURL(/\/forbidden/);
    const res = await page.request.post("/api/ai/chat", { data: { message: "hi" } });
    expect(res.status()).toBe(403);
  });
});

test.describe("manager chats under their own RLS", () => {
  test.use({ storageState: storageStatePath("manager") });

  test("chat answers (or degrades) and writes ai_messages + ai_usage", async ({ page }) => {
    test.setTimeout(300_000); // agent loop + tool calls against a live LLM is slow
    const users = readUsers();
    const managerId = users.manager!.userId;

    const msgBefore = await serviceDb()
      .from("ai_messages")
      .select("id", { count: "exact", head: true });

    await page.goto("/ai");

    if (!aiConfigured) {
      await expect(page.getByText(/not configured/i).first()).toBeVisible();
      return;
    }

    await page
      .locator("textarea")
      .fill("How much did model E2E-M1 earn in the period 2026-08-10 to 2026-08-11?");
    await page.getByRole("button", { name: "Send" }).click();

    // The answer must reflect data the MANAGER can see (E2E-M1's 1000 net /
    // 600 share posted in scenario 3).
    await expect(page.getByText(/1,?000|600/).first()).toBeVisible({ timeout: 240_000 });

    const msgAfter = await serviceDb()
      .from("ai_messages")
      .select("id", { count: "exact", head: true });
    expect((msgAfter.count ?? 0) - (msgBefore.count ?? 0)).toBeGreaterThanOrEqual(2); // user + assistant

    const { data: usage } = await serviceDb()
      .from("ai_usage")
      .select("id, user_id, request_kind")
      .eq("user_id", managerId)
      .order("created_at", { ascending: false })
      .limit(5);
    expect(usage?.some((u) => u.request_kind === "chat")).toBe(true);
  });
});

test.describe("provider switch is SA-only and audited", () => {
  test.use({ storageState: storageStatePath("super_admin") });

  test("SA switches provider; ai.model_switch is audited; switch back", async ({ page }) => {
    const db = serviceDb();
    const { data: settingBefore } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "ai.active_provider")
      .single();
    const original = JSON.parse(JSON.stringify(settingBefore!.value)) as string;
    const target = original === "moonshot" ? "zhipu" : "moonshot";

    await page.goto("/admin/settings");
    await switchProviderTo(page, target);

    await expect
      .poll(
        async () => {
          const { data } = await db
            .from("app_settings")
            .select("value")
            .eq("key", "ai.active_provider")
            .single();
          return data?.value;
        },
        { timeout: 20_000 },
      )
      .toBe(target);

    const { data: audit } = await db
      .from("audit_log")
      .select("action, actor_id")
      .eq("action", "ai.model_switch")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(audit?.length).toBe(1);

    // Restore the original provider. NOT via the UI: the settings page keeps a
    // 60s in-process cache per bundle instance, so immediately after the switch
    // it can still render the old active provider and the restore becomes a
    // disabled-button no-op (the exact staleness the docs warn about). The
    // audited UI switch is already proven above; restoration is fixture
    // management, done at the service level like the setup baseline.
    await db.from("app_settings").update({ value: original }).eq("key", "ai.active_provider");
    await expect
      .poll(async () => {
        const { data } = await db
          .from("app_settings")
          .select("value")
          .eq("key", "ai.active_provider")
          .single();
        return data?.value;
      })
      .toBe(original);
  });

  test("finance cannot switch the provider at the database boundary", async () => {
    const { dbAs } = await import("./helpers/db");
    const { data: before } = await serviceDb()
      .from("app_settings")
      .select("value")
      .eq("key", "ai.active_provider")
      .single();

    const db = dbAs("finance");
    const { data, error } = await db
      .from("app_settings")
      .update({ value: "zhipu" })
      .eq("key", "ai.active_provider")
      .select("key");
    if (error) {
      expect(error.message).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
    const { data: check } = await serviceDb()
      .from("app_settings")
      .select("value")
      .eq("key", "ai.active_provider")
      .single();
    expect(check?.value).toEqual(before?.value); // unchanged
  });
});
