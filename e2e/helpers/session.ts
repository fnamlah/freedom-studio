import { expect, type Page } from "@playwright/test";

import { totpCode, waitForNextTotpWindow } from "./totp";

/**
 * Browser flows for the auth lifecycle. Selectors mirror the real components:
 * accept-form (#password/#confirm, "Set password and continue"), enroll-form
 * (plain-text secret in <code>, #otp, "Verify and continue"), login-form
 * (#email/#password, "Sign in"), challenge-form (#otp, "Verify").
 */

/**
 * Drive an invite action_link through accept → forced TOTP enrollment.
 * Returns the base32 TOTP secret scraped from the enrollment page.
 */
export async function acceptInviteAndEnroll(
  page: Page,
  actionLink: string,
  password: string,
): Promise<string> {
  await page.goto(actionLink);
  await page.waitForURL(/\/auth\/accept/, { timeout: 30_000 });

  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.getByRole("button", { name: "Set password and continue" }).click();

  // Forced enrollment — the middleware will not let this session anywhere else.
  await page.waitForURL(/\/auth\/mfa-enroll/, { timeout: 30_000 });
  const secret = (await page.locator("code").innerText()).replace(/\s+/g, "");
  expect(secret.length).toBeGreaterThanOrEqual(16);

  await enterOtpUntilAccepted(page, secret, "Verify and continue");
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  return secret;
}

/** Password + TOTP login; leaves the page on /dashboard. */
export async function login(
  page: Page,
  email: string,
  password: string,
  totpSecret: string,
): Promise<void> {
  await page.goto("/auth/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/auth\/mfa-challenge/, { timeout: 30_000 });
  await enterOtpUntilAccepted(page, totpSecret, "Verify");
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/**
 * Fill the OTP and submit; if the server rejects the code (edge of a 30s
 * window, or replay of a just-used code), wait for the next window and retry.
 * The enroll page's post-verify "Finish and continue" retry button (which
 * never re-asks for a consumed code) is clicked if it appears.
 *
 * Deliberately poll-based: on `next dev` the first compile of /dashboard can
 * take longer than any single sensible waitFor timeout, and a success that
 * lands after the wait would otherwise leave the loop stuffing codes into an
 * #otp field that no longer exists.
 */
export async function enterOtpUntilAccepted(
  page: Page,
  secret: string,
  submitLabel: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (page.url().includes("/dashboard")) return;

    try {
      await page.locator("#otp").fill(totpCode(secret), { timeout: 15_000 });
      await page.getByRole("button", { name: submitLabel }).click();
    } catch (error) {
      // The field vanished — success beat us to it, or the page moved on.
      if (page.url().includes("/dashboard")) return;
      throw error;
    }

    const deadline = Date.now() + 120_000;
    let rejected = false;
    while (Date.now() < deadline) {
      if (page.url().includes("/dashboard")) return;

      const finish = page.getByRole("button", { name: "Finish and continue" });
      if ((await finish.count()) > 0) {
        await finish.click();
        await page.waitForURL(/\/dashboard/, { timeout: 120_000 });
        return;
      }

      if ((await page.locator('[role="alert"]').count()) > 0) {
        rejected = true; // server refused this code — retry in the next window
        break;
      }

      await page.waitForTimeout(500);
    }

    if (!rejected && page.url().includes("/dashboard")) return;
    await waitForNextTotpWindow();
  }
  throw new Error("TOTP verification did not succeed after 3 attempts");
}
