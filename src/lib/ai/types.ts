/**
 * Shared AI types — the vocabulary every other AI module and Wave-2 surface
 * imports (docs/11 §2.1). Client-safe: this module reads no secrets and touches
 * no server-only API, so it may be imported from anywhere for its types.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { dict, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/** A Supabase client typed against our schema — caller-context or service-role. */
export type AiSupabaseClient = SupabaseClient<Database, "public">;

/** The two switchable providers (docs/11 §2.1). Tied to the DB enum. */
export type ProviderId = Database["public"]["Enums"]["ai_provider"];

/** Embedding source kinds (docs/11 §6.1). Tied to the DB enum. */
export type EmbeddingSource = Database["public"]["Enums"]["embedding_source"];

/* ------------------------------------------------------------------ messages */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatTextPart = { type: "text"; text: string };
export type ChatImagePart = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
/** Multimodal content part (used by the vision classification branch, docs/12 §4.2). */
export type ChatContentPart = ChatTextPart | ChatImagePart;

/** Message content: a plain string, an ordered array of parts, or null. */
export type ChatContent = string | ChatContentPart[] | null;

export interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
  /** Optional tool name (OpenAI `name` field). */
  name?: string;
  /** Present on assistant messages that requested tools. */
  tool_calls?: ToolCall[];
  /** Present on `role: "tool"` results, links back to the requesting call. */
  tool_call_id?: string;
}

/* --------------------------------------------------------------- tool-calls */

export interface ToolCallFunction {
  name: string;
  /** OpenAI serializes tool arguments as a JSON *string*. */
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

/** A tool definition in OpenAI `tools` shape (docs/11 §4). */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/* -------------------------------------------------------------------- usage */

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/* ------------------------------------------------------------------ chat io */

export interface ChatOptions {
  messages: ChatMessage[];
  model: string;
  tools?: Tool[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Result of a non-streaming completion. */
export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string | null;
  model: string;
}

/**
 * A streaming event. `text` events arrive incrementally as the model writes;
 * exactly one terminal `done` event carries the fully-assembled message
 * (content + any tool calls), the token usage, and the finish reason.
 */
export type ChatDelta =
  | { type: "text"; text: string }
  | {
      type: "done";
      content: string | null;
      toolCalls: ToolCall[];
      usage: Usage;
      finishReason: string | null;
    };

/**
 * The provider adapter contract (docs/11 §2.1). One interface, two
 * implementations. Model IDs are always passed in (they come from
 * `app_settings`, never hardcoded); base URLs are the only provider constant.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Streaming completion — yields text deltas then one terminal `done` event. */
  chat(opts: ChatOptions & { stream: true }): AsyncIterable<ChatDelta>;
  /** Non-streaming completion — resolves once with the full result. */
  chat(opts: ChatOptions & { stream?: false }): Promise<ChatResult>;
  embed(texts: string[], model: string): Promise<number[][]>;
}

/* ------------------------------------------------------------------ errors */

/**
 * Thrown when the provider needed for an operation has no API key configured.
 * Carries the provider it was reaching for and renders a clean HTTP body so
 * every surface can degrade gracefully (docs/11 §1 non-negotiable 4).
 *
 * The default message follows `locale`, defaulting to the studio's Russian. In
 * practice every UI surface intercepts the CONDITION rather than this text —
 * the chat gateway streams a `not_configured` event and the page renders its own
 * banner; the classify/analyse routes answer `{configured:false}`; the report
 * action substitutes its own sentence — so this string is mostly what lands in a
 * log. It is translated anyway because "mostly" is not "never", and a caller
 * that does surface it should not have to special-case the language.
 */
export class NotConfiguredError extends Error {
  readonly code = "ai_not_configured" as const;
  readonly status = 503;
  readonly provider: ProviderId | null;

  constructor(
    provider: ProviderId | null,
    message?: string,
    locale: Locale = DEFAULT_LOCALE,
  ) {
    const d = dict(locale).adminAi.assistant;
    super(
      message ?? (provider ? d.notConfiguredProvider(provider) : d.notConfigured),
    );
    this.name = "NotConfiguredError";
    this.provider = provider;
    Object.setPrototypeOf(this, NotConfiguredError.prototype);
  }

  toResponseBody(): {
    error: { code: string; message: string; provider: ProviderId | null };
    configured: false;
  } {
    return {
      error: { code: this.code, message: this.message, provider: this.provider },
      configured: false,
    };
  }
}

export function isNotConfiguredError(e: unknown): e is NotConfiguredError {
  return e instanceof NotConfiguredError;
}

/** A non-2xx response from a provider's HTTP API (bad key, quota, outage). */
export class ProviderError extends Error {
  readonly code = "ai_provider_error" as const;
  readonly provider: ProviderId;
  readonly status: number;

  constructor(provider: ProviderId, status: number, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
