import { env } from "../config/env.js";
import { readSetting } from "../lib/settings.js";

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

/**
 * Fallbacks only — the seeded `app_settings` rows shadow these in every real
 * environment. They agree with the app's own fallbacks
 * (`src/lib/ai/provider.ts`) on purpose: this file previously said
 * `kimi-k3-turbo`, an id that appears nowhere else in the repo and could never
 * fire, so the disagreement was invisible until someone deleted a seed row.
 */
const DEFAULT_MODEL: Record<ProviderId, string> = {
  moonshot: "kimi-k3",
  zhipu: "glm-5.2",
};

export async function activeProvider(): Promise<ProviderId> {
  const raw = (await readSetting("ai.active_provider")) ?? "moonshot";
  return raw === "zhipu" ? "zhipu" : "moonshot";
}

/**
 * The chat model, preferring a HERMES-specific override.
 *
 * `ai.chat_model.<provider>` is shared with the portal's assistant, where the
 * job is deep analysis; here it is two-sentence chat over a handful of
 * aggregates. `hermes.chat_model.<provider>` lets the bot run a faster or
 * cheaper model without changing what the portal does — and changing the
 * shared key is a governed action audited as `ai.model_switch`, not something
 * a latency fix should do behind the owner's back.
 *
 * Unset means "use whatever the studio uses", so nothing needs seeding.
 */
export async function chatModelFor(provider: ProviderId): Promise<string> {
  return (
    (await readSetting(`hermes.chat_model.${provider}`)) ??
    (await readSetting(`ai.chat_model.${provider}`)) ??
    DEFAULT_MODEL[provider]
  );
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
 *
 * 25s, not the original 45s: `converse()` now imposes a 60s ceiling on the
 * whole turn, so a 45s request could only ever be the first one and a stall
 * would eat the entire budget. At 25s a stalled call still leaves room for the
 * turn to recover and answer.
 */
const REQUEST_TIMEOUT_MS = 25_000;

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
    // Both bounds apply. A caller-supplied turn deadline must not REPLACE the
    // per-request ceiling — otherwise one stalled request could consume the
    // whole turn budget and leave nothing for a retry or a final answer.
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
