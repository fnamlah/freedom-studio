import { getPolicyValue, setPolicyValue } from "./policy-kv.js";
import { getAdminClient } from "./supabase.js";
import { sendMessage } from "../telegram/api.js";

/**
 * Owner alerting. "The owner" is resolved from the data, not from config: the
 * verified, active Telegram channel bound to the single super_admin profile.
 * If nobody has paired a chat yet, alerts degrade to a log line rather than
 * throwing — a broken alert path must never take down the loop reporting it.
 */

let cachedChatId: string | null | undefined;

export async function ownerChatId(): Promise<string | null> {
  if (cachedChatId !== undefined) return cachedChatId;

  const { data } = await getAdminClient()
    .from("hermes_channels")
    .select("external_id, profiles:profile_id(role, status)")
    .eq("channel_type", "telegram")
    .eq("verified", true)
    .eq("is_active", true)
    .limit(20);

  const row = (data ?? []).find((r) => {
    const p = r.profiles as unknown as { role?: string; status?: string } | null;
    return p?.role === "super_admin" && p?.status === "active";
  });

  cachedChatId = row ? String(row.external_id) : null;
  return cachedChatId;
}

/**
 * Send an alert, throttled per key so a loop failing every 10s cannot turn into
 * hundreds of messages. The throttle marker is written AFTER a successful send,
 * so a failed send doesn't silence the next attempt.
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

    const chatId = await ownerChatId();
    if (!chatId) {
      console.warn(`[alert:${key}] no paired owner chat — ${text}`);
      return;
    }

    await sendMessage(chatId, `⚠️ ${text}`);
    await setPolicyValue(policyKey, new Date().toISOString());
  } catch (e) {
    console.error(`[alert:${key}] failed:`, e instanceof Error ? e.message : e);
  }
}
