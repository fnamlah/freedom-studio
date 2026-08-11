/**
 * Moonshot AI adapter — Kimi K3 (docs/11 §2.1).
 *
 * OpenAI-compatible. Base URL is the only provider constant; the model ID comes
 * from `app_settings` (`ai.chat_model.moonshot` / `ai.vision_model.moonshot`).
 * The key is read at call time from `MOONSHOT_API_KEY`.
 */

import { createOpenAiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type { ProviderAdapter } from "@/lib/ai/types";

export const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";

export const moonshotAdapter: ProviderAdapter = createOpenAiCompatibleAdapter({
  id: "moonshot",
  baseUrl: MOONSHOT_BASE_URL,
  apiKeyEnv: "MOONSHOT_API_KEY",
  // Kimi K3 accepts ONLY temperature=1 and 400s on anything else — omit the
  // field entirely and let the provider default apply (discovered in E2E).
  mapTemperature: () => undefined,
});
