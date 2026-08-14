import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { providerHasKey } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import { requireRole } from "@/lib/auth/guard";
import { getDict } from "@/lib/i18n/server";
import { readAppSettings } from "@/lib/settings";

import { AiSettingsPanel } from "./ai-settings-panel";
import type { AiSettingsSnapshot } from "./settings-meta";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.settings.metaTitle };
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function prov(value: unknown, fallback: ProviderId): ProviderId {
  return value === "moonshot" || value === "zhipu" ? value : fallback;
}

/**
 * AI settings — SUPER ADMIN ONLY (docs/11 §3, docs/04 §4.18 RLS: SA reads and
 * updates `app_settings`).
 *
 * The panel edits the non-secret `ai.*` configuration: the active-provider
 * switch (a governance event, confirmed and audited as `ai.model_switch`), the
 * chat/vision/embedding model IDs, and the three budget knobs the gateway
 * enforces before any provider call. Provider API keys are server-only and never
 * reach this surface — only a boolean "configured" flag does (docs/11 §1).
 *
 * Config is read through `readAppSettings()` (the same cache the gateway uses),
 * so after a write the mutating action invalidates that cache and the page
 * re-renders against fresh values.
 */
export default async function AdminSettingsPage() {
  await requireRole("super_admin");
  const dict = await getDict();
  const d = dict.adminAi.settings;

  const settings = await readAppSettings();

  const snapshot: AiSettingsSnapshot = {
    activeProvider: prov(settings["ai.active_provider"], "moonshot"),
    configured: {
      moonshot: providerHasKey("moonshot"),
      zhipu: providerHasKey("zhipu"),
      openai: providerHasKey("openai"),
    },
    chatModel: {
      moonshot: str(settings["ai.chat_model.moonshot"], "kimi-k3"),
      zhipu: str(settings["ai.chat_model.zhipu"], "glm-5.2"),
      // Embeddings-only in this studio; present because the type demands it.
      openai: str(settings["ai.chat_model.openai"], "gpt-5.2"),
    },
    visionModel: {
      moonshot: str(settings["ai.vision_model.moonshot"], "kimi-k3-vision"),
      zhipu: str(settings["ai.vision_model.zhipu"], "glm-5.2v"),
      openai: str(settings["ai.vision_model.openai"], "gpt-5.2"),
    },
    embeddingProvider: prov(settings["ai.embedding.provider"], "openai"),
    embeddingModel: str(settings["ai.embedding.model"], "text-embedding-3-large"),
    embeddingDim: int(settings["ai.embedding.dim"], 2048),
    limits: {
      requestsPerUserPerHour: int(settings["ai.limits.requests_per_user_per_hour"], 30),
      tokensPerUserPerDay: int(settings["ai.limits.tokens_per_user_per_day"], 200_000),
      tokensGlobalPerDay: int(settings["ai.limits.tokens_global_per_day"], 1_000_000),
    },
    classify: {
      batchSize: int(settings["ai.classify.batch_size"], 5),
      maxFileMb: int(settings["ai.classify.max_file_mb"], 10),
    },
  };

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.description}
        breadcrumbs={[{ label: dict.nav.sectionAdmin }, { label: dict.nav.settings }]}
      />

      <AiSettingsPanel snapshot={snapshot} />
    </>
  );
}
