import type { ProviderId } from "@/lib/ai/types";

/**
 * Shared, dependency-free constants and types for the AI settings surface.
 *
 * This module is imported by BOTH the server page and the `"use client"` panel,
 * so it must stay free of server-only imports — only plain data and type-only
 * imports (erased at compile time) live here.
 */

/** Human labels for the two switchable chat providers (docs/11 §2.1, §3). */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  moonshot: "Kimi K3 · Moonshot",
  zhipu: "GLM 5.2 · Zhipu",
};

/** The server env var each provider's key lives in (value NEVER surfaced — name only). */
export const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  moonshot: "MOONSHOT_API_KEY",
  zhipu: "ZHIPU_API_KEY",
};

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
