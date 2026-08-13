import type { ProviderId } from "@/lib/ai/types";

/**
 * Shared, dependency-free constants and types for the AI settings surface.
 *
 * This module is imported by BOTH the server page and the `"use client"` panel,
 * so it must stay free of server-only imports — only plain data and type-only
 * imports (erased at compile time) live here.
 */

/**
 * Human labels for the two switchable chat providers (docs/11 §2.1, §3).
 *
 * NOT localized, and deliberately so: "Kimi K3" and "GLM 5.2" are model names
 * and "Moonshot"/"Zhipu" are vendor names — proper nouns, which the translation
 * rules keep as they are in every language. A Russian reader looking for the key
 * to set is looking for exactly this string. The surrounding sentences that
 * MENTION a provider are translated and take the label as an argument
 * (`d.adminAi.settings.switchDialogBody(next, current)`), so the label never has
 * to carry grammar with it.
 */
export { PROVIDER_LABELS, PROVIDER_KEY_ENV } from "@/lib/ai/types";


export const PROVIDER_IDS: readonly ProviderId[] = ["moonshot", "zhipu"];

/**
 * A point-in-time read of the editable `ai.*` configuration, assembled
 * server-side from `app_settings` and the presence of each provider key. Only
 * booleans describe key state — key material is never sent to the client.
 */
export type AiSettingsSnapshot = {
  activeProvider: ProviderId;
  /** Whether each provider's server API key is present. Booleans only. */
  configured: Record<ProviderId, boolean>;
  chatModel: Record<ProviderId, string>;
  visionModel: Record<ProviderId, string>;
  embeddingProvider: ProviderId;
  embeddingModel: string;
  embeddingDim: number;
  limits: {
    requestsPerUserPerHour: number;
    tokensPerUserPerDay: number;
    tokensGlobalPerDay: number;
  };
  classify: { batchSize: number; maxFileMb: number };
};
