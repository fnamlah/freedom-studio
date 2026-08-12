import type { Json } from "@studio/lib/database.types.js";
import { getAdminClient } from "./supabase.js";

/**
 * `hermes_policy` is the worker's single KV spine: loop heartbeats, the daily
 * cost accumulator, the Telegram offset, job claim markers, alert throttles and
 * feature kill-switches all live here. Keeping them in one table means one
 * place to inspect when the agent misbehaves, and one place to switch it off.
 */

export async function getPolicyValue<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await getAdminClient()
    .from("hermes_policy")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return data.value as T;
}

export async function setPolicyValue(
  key: string,
  value: Json,
  description?: string,
): Promise<void> {
  const { error } = await getAdminClient()
    .from("hermes_policy")
    .upsert({ key, value, description, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`setPolicyValue(${key}): ${error.message}`);
}

/** Feature kill-switch. Defaults to ON only when the key is absent entirely. */
export async function isEnabled(key: string, dflt = true): Promise<boolean> {
  const v = await getPolicyValue<boolean>(key);
  return typeof v === "boolean" ? v : dflt;
}
