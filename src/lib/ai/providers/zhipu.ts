/**
 * Zhipu (Z.ai) adapter — GLM 5.2 (docs/11 §2.1), and the default embedding
 * provider (docs/11 §6.2).
 *
 * OpenAI-compatible. Base URL is the only provider constant; model IDs come from
 * `app_settings` (`ai.chat_model.zhipu` / `ai.vision_model.zhipu` /
 * `ai.embedding.model`). The key is read at call time from `ZHIPU_API_KEY`.
 */

import { createOpenAiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type { ProviderAdapter } from "@/lib/ai/types";

export const ZHIPU_BASE_URL = "https://api.z.ai/api/paas/v4";

export const zhipuAdapter: ProviderAdapter = createOpenAiCompatibleAdapter({
  id: "zhipu",
  baseUrl: ZHIPU_BASE_URL,
  apiKeyEnv: "ZHIPU_API_KEY",
});
