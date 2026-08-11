import { randomBytes } from "node:crypto";

import { expect, test as setup, type Page } from "@playwright/test";

import {
  ensureModelRow,
  ensureOperatorRow,
  findUserByEmail,
  generateInviteLink,
  getProfile,
  insertInvitation,
  resetUserForReseed,
  setProfileStatus,
} from "./helpers/admin";
import { loadEnv } from "./helpers/env";
import { e2eEmail, ROLES, type E2ERole } from "./helpers/naming";
import { acceptInviteAndEnroll, enterOtpUntilAccepted, login } from "./helpers/session";
import {
  ensureStateDir,
  readUsers,
  storageStatePath,
  writeRun,
  writeUsers,
  type E2EUser,
  type UsersFile,
} from "./helpers/state";

/**
 * Scenario 1 (docs/AGENT-HANDOFF.md §5.D.1) + seeding: create/refresh the five
 * role users against the LIVE database, walking the real invite → accept →
 * forced-TOTP path in a real browser, and capture an AAL2 storageState per role.
 *
 * Re-run safe: existing users get their password reset and TOTP factors wiped
 * (service-level test-account management), then re-enroll through the UI.
 */

setup.describe.configure({ mode: "serial" });
setup.setTimeout(600_000);

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

function freshPassword(): string {
  return `E2e!${randomBytes(9).toString("base64url")}`;
}

async function seedRole(
  page: Page,
  role: E2ERole,
  users: UsersFile,
  links: { modelId?: string; operatorId?: string },
): Promise<E2EUser> {
  const email = e2eEmail(role);
  const password = freshPassword();
  const existing = await findUserByEmail(email);

  let userId: string;
  let totpSecret: string;

  if (!existing) {
    await insertInvitation({ email, role, ...links });
    const actionLink = await generateInviteLink(email, baseURL);
    const created = await findUserByEmail(email);
    if (!created) throw new Error(`generateLink did not create auth user for ${email}`);
    userId = created.id;

    // The trigger must have created an invited profile with the right role.
    const profile = await getProfile(userId);
    expect(profile?.role).toBe(role);
    expect(profile?.status).toBe("invited");

    // Scenario 1: between password and TOTP enrollment the middleware must
    // refuse the app surface (probe once, on the model role).
    if (role === "model") {
      await page.goto(actionLink);
      await page.waitForURL(/\/auth\/accept/);
      await page.locator("#password").fill(password);
      await page.locator("#confirm").fill(password);
      await page.getByRole("button", { name: "Set password and continue" }).click();
      await page.waitForURL(/\/auth\/mfa-enroll/);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/auth\/mfa-enroll/); // bounced straight back
      const secret = (await page.locator("code").innerText()).replace(/\s+/g, "");
      totpSecret = secret;
      await enterOtpUntilAccepted(page, secret, "Verify and continue");
      await page.waitForURL(/\/dashboard/);
    } else {
      totpSecret = await acceptInviteAndEnroll(page, actionLink, password);
    }
  } else {
    userId = existing.id;
    await resetUserForReseed(userId, password);
    await setProfileStatus(userId, "active");
    // Factors were wiped → login lands on forced re-enrollment. The admin
    // password reset can lag GoTrue's token endpoint by a moment, so a
    // rejected first attempt is retried.
    let signedIn = false;
    for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
      await page.goto("/auth/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      signedIn = await page
        .waitForURL(/\/auth\/mfa-enroll/, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!signedIn) await page.waitForTimeout(3_000);
    }
    if (!signedIn) throw new Error(`login for ${email} kept failing after password reset`);
    const secret = (await page.locator("code").innerText()).replace(/\s+/g, "");
    totpSecret = secret;
    await enterOtpUntilAccepted(page, secret, "Verify and continue");
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }

  // Profile must now be active (the sanctioned post-TOTP activation ran).
  const profile = await getProfile(userId);
  expect(profile?.status).toBe("active");

  // Scenario 1: the dashboard actually renders for this role.
  await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();

  await page.context().storageState({ path: storageStatePath(role) });

  const user: E2EUser = { email, password, totpSecret, userId, ...links };
  users[role] = user;
  writeUsers(users);

  // Sign out via UI is client-side; clearing cookies is equivalent and faster.
  await page.context().clearCookies();
  return user;
}

setup("seed all five role users with forced TOTP", async ({ page }) => {
  loadEnv();
  ensureStateDir();
  const users = readUsers();

  // Fixture baseline: an aborted provider-switch test can leave the active
  // provider on the un-keyed one, which disables every AI surface. (The
  // app_settings audit trigger records this restoration.)
  const { serviceDb } = await import("./helpers/admin");
  await serviceDb()
    .from("app_settings")
    .update({ value: "moonshot" })
    .eq("key", "ai.active_provider")
    .neq("value", '"moonshot"');

  // Staff first — the SA profile authors the business fixture rows.
  const sa = await seedRole(page, "super_admin", users, {});
  await seedRole(page, "manager", users, {});
  await seedRole(page, "finance", users, {});

  const modelId = await ensureModelRow(sa.userId);
  const operatorId = await ensureOperatorRow(sa.userId);
  writeRun({ modelId, operatorId });

  await seedRole(page, "model", users, { modelId });
  await seedRole(page, "operator", users, { operatorId });

  // Sanity: exactly our five e2e users hold the expected roles.
  for (const role of ROLES) {
    expect(users[role]?.userId).toBeTruthy();
  }

  // Verify the login → challenge path once (fresh session for the SA).
  const saved = users["super_admin"];
  if (!saved) throw new Error("unreachable");
  await login(page, saved.email, saved.password, saved.totpSecret);
  await page.context().storageState({ path: storageStatePath("super_admin") });
});
