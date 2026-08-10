/**
 * Environment access.
 *
 * Safe to import from BOTH server and client code: the two public constants are
 * read as literal `process.env.NEXT_PUBLIC_*` member accesses so Next.js inlines
 * them into the client bundle. No server secret is ever read at module scope.
 *
 * Secrets inventory: docs/08-security-threat-model.md §4.4.
 */

/** Public Supabase project URL. Present in the browser bundle by design. */
export const SUPABASE_URL: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** Publishable (anon) key. The ONLY Supabase key that may reach a browser. */
export const SUPABASE_ANON_KEY: string =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Throws a clear, non-leaking error when a required variable is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/** Reads an optional variable, returning `fallback` when unset or empty. */
export function optionalEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** True when both public Supabase variables are configured. */
export function hasSupabaseEnv(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * Absolute origin of this deployment, e.g. `https://studio.example.com`.
 * Order: APP_BASE_URL -> VERCEL_PROJECT_PRODUCTION_URL -> VERCEL_URL -> localhost.
 * Server-only (VERCEL_* are not exposed to the browser).
 */
export function appBaseUrl(): string {
  const explicit = optionalEnv("APP_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelProd = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercelProd) return `https://${vercelProd}`;

  const vercel = optionalEnv("VERCEL_URL");
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/**
 * Origin of the Supabase project, used to pin `connect-src` in the CSP.
 * Returns an empty string when the URL is unset/unparseable.
 */
export function supabaseOrigin(): string {
  if (!SUPABASE_URL) return "";
  try {
    return new URL(SUPABASE_URL).origin;
  } catch {
    return "";
  }
}

export const IS_PRODUCTION: boolean = process.env.NODE_ENV === "production";
