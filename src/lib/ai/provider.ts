/**
 * Active-provider and model resolution (docs/11 §3, §6.2).
 *
 * SERVER-ONLY. Reads the `ai.*` model/provider settings from `app_settings`
 * (through the 60s-TTL cache in `@/lib/settings`) and hands back the matching
 * adapter. Every accessor that returns something the caller intends to *use*
 * throws `NotConfiguredError` when the needed provider key is absent, so an
 * unusable configuration fails fast at a typed boundary. `isAiConfigured()` is
 * the non-throwing probe for graceful UI.
 *
 * Model IDs are NEVER hardcoded here — the string literals are last-resort
 * fallbacks that mirror the migration seed, used only if a settings row is
 * somehow missing.
 */

import { getSetting } from "@/lib/settings";

import { moonshotAdapter } from "./providers/moonshot";
import { zhipuAdapter } from "./providers/zhipu";
import { NotConfiguredError, type ProviderAdapter, type ProviderId } from "./types";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  moonshot: moonshotAdapter,
  zhipu: zhipuAdapter,
};

const KEY_ENV: Record<ProviderId, string> = {
  moonshot: "MOONSHOT_API_KEY",
  zhipu: "ZHIPU_API_KEY",
};

const DEFAULT_CHAT_MODEL: Record<ProviderId, string> = {
  moonshot: "kimi-k3",
  zhipu: "glm-5.2",
};

const DEFAULT_VISION_MODEL: Record<ProviderId, string> = {
  moonshot: "kimi-k3-vision",
  zhipu: "glm-5.2v",
};

function coerceProvider(value: unknown, fallback: ProviderId): ProviderId {
  return value === "moonshot" || value === "zhipu" ? value : fallback;
}

/** True when this provider's API key is present in the server environment. */
export function providerHasKey(id: ProviderId): boolean {
  const v = process.env[KEY_ENV[id]];
  return typeof v === "string" && v.length > 0;
}

/** The configured active chat provider id (`ai.active_provider`). No key check. */
export async function getActiveProviderId(): Promise<ProviderId> {
  return coerceProvider(await getSetting("ai.active_provider", "moonshot"), "moonshot");
}

/**
 * The active chat provider adapter.
 * @throws {NotConfiguredError} when the active provider has no key.
 */
export async function getActiveProvider(): Promise<ProviderAdapter> {
  const id = await getActiveProviderId();
  if (!providerHasKey(id)) throw new NotConfiguredError(id);
  return ADAPTERS[id];
}

/**
 * Chat model id for the active provider (`ai.chat_model.{provider}`).
 * @throws {NotConfiguredError} when the active provider has no key.
 */
export async function getChatModel(): Promise<string> {
  const id = await getActiveProviderId();
  if (!providerHasKey(id)) throw new NotConfiguredError(id);
  return getSetting(`ai.chat_model.${id}`, DEFAULT_CHAT_MODEL[id]);
}

/**
 * Vision model id for the active provider (`ai.vision_model.{provider}`).
 * @throws {NotConfiguredError} when the active provider has no key.
 */
export async function getVisionModel(): Promise<string> {
  const id = await getActiveProviderId();
  if (!providerHasKey(id)) throw new NotConfiguredError(id);
  return getSetting(`ai.vision_model.${id}`, DEFAULT_VISION_MODEL[id]);
}

/**
 * The embedding provider id (`ai.embedding.provider`) — decoupled from the chat
 * switch on purpose (docs/11 §6.2), so switching chat providers never
 * invalidates stored vectors.
 */
export async function getEmbeddingProvider(): Promise<ProviderId> {
  return coerceProvider(await getSetting("ai.embedding.provider", "zhipu"), "zhipu");
}

/**
 * Embedding model id (`ai.embedding.model`).
 * @throws {NotConfiguredError} when the embedding provider has no key.
 */
export async function getEmbeddingModel(): Promise<string> {
  const id = await getEmbeddingProvider();
  if (!providerHasKey(id)) throw new NotConfiguredError(id);
  return getSetting("ai.embedding.model", "embedding-3");
}

/**
 * The embedding provider adapter.
 * @throws {NotConfiguredError} when the embedding provider has no key.
 */
export async function getEmbeddingAdapter(): Promise<ProviderAdapter> {
  const id = await getEmbeddingProvider();
  if (!providerHasKey(id)) throw new NotConfiguredError(id);
  return ADAPTERS[id];
}

/**
 * Non-throwing probe: is the active chat provider usable right now? Use for
 * graceful UI (hide/disable the AI surface) instead of catching the errors the
 * accessors above throw.
 */
export async function isAiConfigured(): Promise<boolean> {
  try {
    return providerHasKey(await getActiveProviderId());
  } catch {
    return false;
  }
}
