import { createServerSupabase } from "@/lib/supabase/server";
import {
  createServiceRoleClient,
  hasServiceRoleKey,
} from "@/lib/supabase/service-internal";

/**
 * Typed global configuration reader for `app_settings` (docs/04 §4.18).
 *
 * SERVER-ONLY. Two properties make the module-level cache safe:
 *  - `app_settings` is NON-SECRET by design ("secrets never live here" — 04 §4.18),
 *    so nothing cached here is sensitive.
 *  - the read is CALLER-INDEPENDENT: it always returns the same global config,
 *    which is why a shared, cross-request cache cannot leak one user's view to
 *    another. Never extend this module with per-caller data.
 *
 * The read prefers a service-role client so server internals (the AI gateway's
 * provider switch, budget knobs) resolve config regardless of the caller's RLS
 * grants on `app_settings`; it falls back to the caller's RLS-scoped client when
 * no service key is configured (e.g. local dev).
 */

const TTL_MS = 60_000;

type CacheEntry = { value: Record<string, unknown>; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const CACHE_KEY = "app_settings";

let inFlight: Promise<Record<string, unknown>> | null = null;

/**
 * Reads all settings as a flat `{ key: value }` map, memoised for 60 seconds.
 *
 * ```ts
 * const settings = await readAppSettings();
 * const provider = settings["ai.active_provider"];
 * ```
 */
export async function readAppSettings(): Promise<Record<string, unknown>> {
  if (typeof window !== "undefined") {
    throw new Error("readAppSettings is server-only.");
  }

  const cached = cache.get(CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Collapse concurrent misses into a single query.
  if (inFlight) return inFlight;

  inFlight = fetchSettings()
    .then((value) => {
      cache.set(CACHE_KEY, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .catch((error: unknown) => {
      // Serve a stale copy rather than breaking a page on a transient DB error.
      if (cached) return cached.value;
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Reads a single setting with a typed fallback. The fallback is returned when
 * the key is absent or `null` — never when it is legitimately `false` or `0`.
 *
 * ```ts
 * const provider = await getSetting<"moonshot" | "zhipu">("ai.active_provider", "moonshot");
 * const dailyCap = await getSetting<number>("ai.limits.tokens_global_per_day", 1_000_000);
 * ```
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await readAppSettings();
  const value = settings[key];
  return value === undefined || value === null ? fallback : (value as T);
}

/**
 * Drops the cached snapshot. Call immediately after any write to `app_settings`
 * (e.g. the Super Admin switching the active AI provider) so the change is
 * visible without waiting out the TTL.
 */
export function invalidateSettingsCache(): void {
  cache.delete(CACHE_KEY);
  inFlight = null;
}

/** Age of the cached snapshot in ms, or `null` when nothing is cached. Diagnostics only. */
export function settingsCacheAgeMs(): number | null {
  const cached = cache.get(CACHE_KEY);
  if (!cached) return null;
  return TTL_MS - (cached.expiresAt - Date.now());
}

async function fetchSettings(): Promise<Record<string, unknown>> {
  const client = hasServiceRoleKey()
    ? createServiceRoleClient()
    : await createServerSupabase();

  const { data, error } = await client.from("app_settings").select("key, value");
  if (error) throw new Error(`Could not read app_settings: ${error.message}`);

  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }
  return settings;
}
