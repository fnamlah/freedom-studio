import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite — runs against the LIVE Supabase project (no test doubles).
 *
 * Strictly serial (workers: 1): one shared database, ordered scenarios
 * (accounting → payouts → audit), the share-view Edge Function's 20 req/IP/60s
 * rate limit, per-user AI budgets, and TOTP 30-second windows all rule out
 * parallelism. Spec order is the numeric filename prefix.
 *
 * `E2E_PROD=1` runs against `next start` (production build — the CSP and the
 * /share rewrite behave differently there); default is `next dev`.
 * `E2E_BASE_URL` overrides the target entirely (e.g. the Vercel deployment).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const isExternal = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: isExternal
    ? undefined
    : {
        command:
          process.env.E2E_PROD === "1"
            ? "npm run start -- -p 3100"
            : "npm run dev -- -p 3100",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
