/**
 * OpenAI adapter — the studio's EMBEDDING provider (034).
 *
 * Chosen because z.ai's international platform sells no embeddings product
 * and Moonshot has no embeddings API — verified 2026-08-14, both empirically
 * and in their docs. Chat stays on Moonshot (Zhipu as fallback); this adapter
 * exists for `text-embedding-3-large`, pinned to 2048 dimensions so vectors
 * drop into the existing `embeddings.embedding vector(2048)` column with no
 * schema change.
 */

import { createOpenAiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type { ProviderAdapter } from "@/lib/ai/types";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const openaiAdapter: ProviderAdapter = createOpenAiCompatibleAdapter({
  id: "openai",
  baseUrl: OPENAI_BASE_URL,
  apiKeyEnv: "OPENAI_API_KEY",
  embedDimensions: 2048,
});
