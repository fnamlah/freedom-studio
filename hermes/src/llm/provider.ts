import { env } from "../config/env.js";
import { getAdminClient } from "../lib/supabase.js";

/**
 * The worker's provider call — the FIRST one Hermes has ever made.
 *
 * Deliberately its own minimal client rather than an import of the app's
 * `src/lib/ai/provider.ts`: that module reads settings through
 * `@/lib/settings`, which reaches `next/headers`, so it cannot load outside a
 * request. What it does share with the app is the thing that matters — the
 * ACTIVE PROVIDER and MODEL are read from the same `app_settings` rows, so
 * switching provider in the portal switches it here too, rather than the bot
 * quietly talking to a provider nobody selected.
 *
 * OpenAI-compatible `/chat/completions` covers both configured providers.
 * Streaming is not used: a Telegram reply is sent whole.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string) {
    super(`No API key configured for provider "${providerId}"`);
    this.name = "ProviderNotConfiguredError";
  }
}

type ProviderId = "moonshot" | "zhipu";

const DEFAULT_MODEL: Record<ProviderId, string> = {
  moonshot: "kimi-k3-turbo",
  zhipu: "glm-5.2",
};

async function readSetting(key: string): Promise<string | null> {
  const { data } = await getAdminClient()
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const v = data?.value;
  if (typeof v === "string") return v;
  // `app_settings.value` is jsonb; a plain string arrives already unwrapped by
  // PostgREST, but a JSON-encoded string does not.
  if (v && typeof v === "object") return null;
  return v == null ? null : String(v);
}

export async function activeProvider(): Promise<ProviderId> {
  const raw = (await readSetting("ai.active_provider")) ?? "moonshot";
  return raw === "zhipu" ? "zhipu" : "moonshot";
}

export async function chatModelFor(provider: ProviderId): Promise<string> {
  return (await readSetting(`ai.chat_model.${provider}`)) ?? DEFAULT_MODEL[provider];
}

/**
 * Temperature is provider-specific and NOT universally accepted: Kimi K3
 * rejects anything but 1, which is why the app's own Moonshot adapter maps it
 * to `undefined` (`src/lib/ai/providers/moonshot.ts`). Mirrored here rather
 * than re-derived — a hardcoded 0.2 makes every call 400.
 */
function temperatureFor(provider: ProviderId, requested: number): number | undefined {
  return provider === "moonshot" ? undefined : requested;
}

function credentialsFor(provider: ProviderId): { key: string; baseUrl: string } {
  const key = provider === "zhipu" ? env.ZHIPU_API_KEY : env.MOONSHOT_API_KEY;
  if (!key) throw new ProviderNotConfiguredError(provider);
  return {
    key,
    baseUrl: provider === "zhipu" ? env.ZHIPU_BASE_URL : env.MOONSHOT_BASE_URL,
  };
}

/**
 * How long one provider request may take before it is abandoned.
 *
 * Not optional: the Telegram poller consumes updates SERIALLY
 * (workers/telegram-poller.ts awaits each `processUpdate` in turn), so a
 * request that connects and then stalls does not merely delay one answer — it
 * freezes the whole bot, including the approval buttons, until the socket
 * eventually dies. A turn can make several of these, so the ceiling is
 * per-request and deliberately shorter than a person's patience.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * One non-streaming completion. Every string in `messages` and every tool
 * result has ALREADY passed the redactor before reaching here — this function
 * is transport, not a policy boundary, and must never be given raw rows.
 */
export async function chat(input: {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const provider = await activeProvider();
  const model = await chatModelFor(provider);
  const { key, baseUrl } = credentialsFor(provider);
  const temp = temperatureFor(provider, input.temperature ?? 0.2);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
      ...(temp === undefined ? {} : { temperature: temp }),
      stream: false,
    }),
    // Caller-supplied signal wins; otherwise every request still gets a bound.
    signal: input.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`provider ${provider} ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;

  return {
    content: message?.content ?? null,
    toolCalls: message?.tool_calls ?? [],
    model,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}
