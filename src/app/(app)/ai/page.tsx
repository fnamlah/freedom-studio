import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/guard";
import { getActiveProviderId, isAiConfigured } from "@/lib/ai/provider";
import { getDict } from "@/lib/i18n/server";

import { AiWorkspace } from "./ai-workspace";
import { type ConversationLite } from "./ai-meta";
import { PROVIDER_LABELS } from "@/lib/ai/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).adminAi.assistant.metaTitle };
}

/**
 * AI Assistant (docs/11 §2). Super Admin, Manager and Finance only — the only
 * roles with an AI surface ([D10]); Model and Operator have no policy on
 * `ai_conversations` / `ai_messages`, so RLS is the real boundary and this
 * `requireRole` is the UX floor on top of it.
 *
 * Conversations are OWN-ONLY for every role including the Super Admin ([D11]):
 * this page reads the caller's own conversations under their RLS-scoped client,
 * never a colleague's. The chat itself streams through `/api/ai/chat`.
 */
export default async function AiPage() {
  const { supabase } = await requireRole("super_admin", "manager", "finance");
  const d = (await getDict()).adminAi.assistant;

  const [{ data: conversations }, aiConfigured, providerId] = await Promise.all([
    supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false }),
    isAiConfigured(),
    getActiveProviderId(),
  ]);

  return (
    <>
      <PageHeader
        title={d.title}
        description={d.description}
        breadcrumbs={[{ label: d.title }]}
      />

      <AiWorkspace
        initialConversations={(conversations ?? []) as ConversationLite[]}
        aiConfigured={aiConfigured}
        providerId={providerId}
        providerLabel={PROVIDER_LABELS[providerId]}
      />
    </>
  );
}
