import { roleSatisfies } from "../governance/policy.js";
import { roleMayUseBot } from "../telegram/access.js";
import { getPolicyValue, setPolicyValue } from "./policy-kv.js";
import { getAdminClient } from "./supabase.js";
import { sendMessage } from "../telegram/api.js";

/**
 * Staff notification fan-out.
 *
 * Recipients are resolved from the data, never from config: the verified,
 * active Telegram channels whose bound profile is active and holds a bot-worthy
 * role (see telegram/access.ts). Since the owner decision of 2026-08-12 there
 * can be more than one super_admin, so "the owner" is a set, not a person.
 *
 * If nobody has paired yet, everything degrades to a log line rather than
 * throwing — a broken alert path must never take down the loop reporting it.
 */

interface StaffChannel {
  chatId: string;
  role: string;
}

let cache: { at: number; channels: StaffChannel[] } | null = null;
const CACHE_MS = 60_000;

export async function listStaffChannels(): Promise<StaffChannel[]> {
  // Short TTL, and only successful lookups are cached — caching an early
  // empty result forever would silence alerts until the next restart.
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.channels;

  const { data, error } = await getAdminClient()
    .from("hermes_channels")
    .select("external_id, profiles:profile_id(role, status)")
    .eq("channel_type", "telegram")
    .eq("verified", true)
    .eq("is_active", true)
    .limit(50);

  if (error) {
    console.warn("[staff-channels] lookup failed:", error.message);
    return cache?.channels ?? [];
  }

  const channels = (data ?? []).flatMap((r) => {
    const p = r.profiles as unknown as { role?: string; status?: string } | null;
    if (p?.status !== "active" || !roleMayUseBot(p?.role)) return [];
    return [{ chatId: String(r.external_id), role: p!.role! }];
  });

  cache = { at: Date.now(), channels };
  return channels;
}

/** Channels allowed to DECIDE an approval requiring `requiredRole`. */
export async function channelsSatisfying(requiredRole: string): Promise<string[]> {
  const channels = await listStaffChannels();
  return channels.filter((c) => roleSatisfies(c.role, requiredRole)).map((c) => c.chatId);
}

/** Every paired staff channel — for daily digests and briefs. */
export async function broadcastStaff(
  text: string,
  opts: { html?: boolean } = {},
): Promise<number> {
  const channels = await listStaffChannels();
  for (const c of channels) {
    try {
      await sendMessage(c.chatId, text, opts);
    } catch (e) {
      console.warn(`[broadcast] ${c.chatId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return channels.length;
}

/**
 * Ops alert to every super_admin, throttled per key so a loop failing every
 * 10s cannot become hundreds of messages. The throttle marker is written AFTER
 * a successful send, so a failed send doesn't silence the next attempt.
 */
export async function alertOwner(
  text: string,
  opts: { key?: string; throttleMs?: number } = {},
): Promise<void> {
  const key = opts.key ?? "generic";
  const throttleMs = opts.throttleMs ?? 15 * 60_000;
  const policyKey = `last_alert:${key}`;

  try {
    const last = await getPolicyValue<string>(policyKey);
    if (last && Date.now() - Date.parse(last) < throttleMs) return;

    const chatIds = await channelsSatisfying("super_admin");
    if (chatIds.length === 0) {
      console.warn(`[alert:${key}] no paired super_admin chat — ${text}`);
      return;
    }

    for (const chatId of chatIds) {
      await sendMessage(chatId, `⚠️ ${text}`);
    }
    await setPolicyValue(policyKey, new Date().toISOString());
  } catch (e) {
    console.error(`[alert:${key}] failed:`, e instanceof Error ? e.message : e);
  }
}
