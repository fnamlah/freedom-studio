import { expect, test } from "@playwright/test";

import { pinEnglish } from "./helpers/session";

/**
 * Scenario 0 — anonymous surface: fail-closed routing, the uniform share 404,
 * and the per-request security headers. No storageState (signed-out).
 */

test.describe("anonymous surface", () => {
  test("app routes redirect signed-out users to login, preserving next", async ({
    request,
  }) => {
    for (const path of ["/dashboard", "/ledger", "/library", "/admin/users"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBeGreaterThanOrEqual(300);
      expect(res.status(), path).toBeLessThan(400);
      const location = res.headers()["location"] ?? "";
      expect(location, path).toContain("/auth/login");
      expect(location, path).toContain(`next=${encodeURIComponent(path)}`);
    }
  });

  test("login page renders and is the only anonymous app page", async ({ page }) => {
    // Anonymous, so no profile locale — the app's pre-login default is Russian
    // (019). Pin English so this suite's English selectors match; a real
    // visitor still gets Russian.
    await pinEnglish(page);
    await page.goto("/auth/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("garbage /share token returns the uniform 404, not a redirect", async ({
    request,
  }) => {
    const res = await request.get("/share/e2e-garbage-token-000000000000", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(404); // NOT a 30x to /auth/login — middleware fix
    const body = await res.text();
    expect(body).toContain("Not found");
  });

  test("two garbage share tokens return byte-identical bodies (no state oracle)", async ({
    request,
  }) => {
    const first = await request.get("/share/e2e-garbage-aaaaaaaaaaaaaaaa");
    await new Promise((r) => setTimeout(r, 2_000)); // stay far under 20 req/min/IP
    const second = await request.get("/share/e2e-garbage-bbbbbbbbbbbbbbbb");
    expect(first.status()).toBe(404);
    expect(second.status()).toBe(404);
    expect(await first.text()).toBe(await second.text());
  });

  test("security headers present with a fresh CSP nonce per request", async ({
    request,
  }) => {
    const first = await request.get("/auth/login");
    const second = await request.get("/auth/login");
    for (const res of [first, second]) {
      const headers = res.headers();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    }
    const nonce = (res: Awaited<ReturnType<typeof request.get>>) =>
      res.headers()["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
    const n1 = nonce(first);
    const n2 = nonce(second);
    expect(n1).toBeTruthy();
    expect(n2).toBeTruthy();
    expect(n1).not.toBe(n2);
  });

  test("AI endpoints refuse unauthenticated callers with 401 JSON, never a redirect", async ({
    request,
  }) => {
    for (const path of ["/api/ai/chat", "/api/ai/classify"]) {
      const res = await request.post(path, {
        data: { message: "hi" },
        maxRedirects: 0,
      });
      expect(res.status(), path).toBe(401);
      expect(res.headers()["content-type"], path).toContain("application/json");
    }
  });
});
