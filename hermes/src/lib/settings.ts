import { getAdminClient } from "./supabase.js";

/**
 * The worker's `app_settings` cache.
 *
 * A deliberate mirror of `src/lib/settings.ts`, not an import: that module
 * reaches `next/headers` and cannot load outside a request. The behaviour is
 * copied because `docs/11-ai-llm.md:105` specifies it — "an in-memory cache
 * with a TTL of at most 60 seconds" — and the worker was simply never brought
 * into line. Before this, `chat()` issued TWO uncached single-key queries on
 * every provider call: up to ten round trips per conversational turn that
 * carried no conversational information at all.
 *
 * Four properties, all from the app's version:
 *   * 60s TTL;
 *   * ONE query for every key, not one per key;
 *   * single-flight — concurrent misses collapse into one query, which matters
 *     now that turns run concurrently (workers/telegram-poller.ts);
 *   * stale-on-error — a transient database blip serves the last good snapshot
 *     rather than failing a reply.
 *
 * ⚠ DO NOT extend this to `hermes_policy`. That table holds the daily cost
 * accumulator and the kill switches: a 60-second-stale cost overshoots the cap,
 * and a 60-second-stale `telegram_enabled` delays a deliberate shutdown.
 * `lib/cost.ts` documents at length why a silently-disarmed breaker is worse
 * than no breaker; caching its inputs would re-create exactly that.
 *
 * Consequence worth knowing: the app's `invalidateSettingsCache()` cannot reach
 * this process, so switching provider in the portal takes up to 60s to appear
 * in Telegram. docs/11 §3 already states and accepts that lag.
 */

const TTL_MS = 60_000;

type Snapshot = Record<string, unknown>;

let cached: { value: Snapshot; expiresAt: number } | null = null;
let inFlight: Promise<Snapshot> | null = null;

async function fetchSettings(): Promise<Snapshot> {
  const { data, error } = await getAdminClient().from("app_settings").select("key, value");
  if (error) throw new Error(`app_settings read failed: ${error.message}`);
  const out: Snapshot = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

/** Every setting as a flat `{ key: value }` map, memoised for 60 seconds. */
export async function readAppSettings(): Promise<Snapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;

  const stale = cached;
  inFlight = fetchSettings()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    })
    .catch((e: unknown) => {
      // A blip must not cost someone their answer. Only throw if we have
      // never had a good snapshot to fall back to.
      if (stale) {
        console.warn("[settings] refresh failed, serving stale:", e instanceof Error ? e.message : e);
        return stale.value;
      }
      throw e;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * One setting as a string, or null. `app_settings.value` is jsonb, so a plain
 * string arrives unwrapped while objects and arrays are not settings this
 * helper can express.
 */
export async function readSetting(key: string): Promise<string | null> {
  const v = (await readAppSettings())[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return null;
  return v == null ? null : String(v);
}

/** Drops the memo. Exposed for tests and for a future in-process settings write. */
export function invalidateSettingsCache(): void {
  cached = null;
}
