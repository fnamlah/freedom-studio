/**
 * OpenAI-compatible provider adapter (docs/11 §2.1).
 *
 * SERVER-ONLY. Both Moonshot (Kimi K3) and Zhipu (GLM 5.2) expose the same
 * `/chat/completions` (tools + streaming) and `/embeddings` surface, so a single
 * implementation over native `fetch` backs both — the concrete adapters differ
 * only in base URL and key env var. No SDK, no heavy dependency: SSE is parsed
 * from the `ReadableStream` by hand.
 *
 * The API key is read from the environment AT CALL TIME — never captured at
 * module load — so a key rotated into the running process takes effect on the
 * next request, and a missing key surfaces as a typed `NotConfiguredError`
 * exactly where the crossing would have happened.
 */

import {
  NotConfiguredError,
  ProviderError,
  type ChatDelta,
  type ChatOptions,
  type ChatResult,
  type ProviderAdapter,
  type ProviderId,
  type ToolCall,
  type Usage,
} from "@/lib/ai/types";

export interface OpenAiCompatibleConfig {
  id: ProviderId;
  /** Base URL WITHOUT trailing slash, e.g. `https://api.moonshot.ai/v1`. */
  baseUrl: string;
  /** Name of the env var holding the API key, e.g. `MOONSHOT_API_KEY`. */
  apiKeyEnv: string;
}

/* ------------------------------------------------------- wire-format shapes */

interface WireToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface WireMessage {
  content?: string | null;
  tool_calls?: WireToolCall[];
}

interface WireChoice {
  message?: WireMessage;
  delta?: WireMessage;
  finish_reason?: string | null;
}

interface WireChatResponse {
  model?: string;
  choices?: WireChoice[];
  usage?: WireUsage;
}

interface WireEmbeddingResponse {
  data?: { index: number; embedding: number[] }[];
  usage?: WireUsage;
}

/* ---------------------------------------------------------------- helpers */

function readKey(config: OpenAiCompatibleConfig): string {
  const key = process.env[config.apiKeyEnv];
  if (typeof key !== "string" || key.length === 0) {
    throw new NotConfiguredError(config.id);
  }
  return key;
}

function normalizeUsage(u: WireUsage | undefined): Usage {
  const promptTokens = u?.prompt_tokens ?? 0;
  const completionTokens = u?.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: u?.total_tokens ?? promptTokens + completionTokens,
  };
}

function normalizeToolCalls(calls: WireToolCall[] | undefined): ToolCall[] {
  if (!calls?.length) return [];
  return calls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    type: "function",
    function: {
      name: c.function?.name ?? "",
      arguments: c.function?.arguments ?? "{}",
    },
  }));
}

function buildBody(opts: ChatOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.maxTokens === "number") body.max_tokens = opts.maxTokens;
  // Ask OpenAI-compatible servers to include a final usage chunk while streaming.
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

async function toProviderError(
  config: OpenAiCompatibleConfig,
  res: Response,
): Promise<ProviderError> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* body already consumed / unreadable */
  }
  return new ProviderError(
    config.id,
    res.status,
    `${config.id} ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
  );
}

/* ------------------------------------------------------------------- chat */

async function chatOnce(
  config: OpenAiCompatibleConfig,
  opts: ChatOptions,
): Promise<ChatResult> {
  const key = readKey(config);
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(buildBody(opts, false)),
    signal: opts.signal,
  });
  if (!res.ok) throw await toProviderError(config, res);

  const json = (await res.json()) as WireChatResponse;
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: normalizeToolCalls(choice?.message?.tool_calls),
    usage: normalizeUsage(json.usage),
    finishReason: choice?.finish_reason ?? null,
    model: json.model ?? opts.model,
  };
}

async function* chatStream(
  config: OpenAiCompatibleConfig,
  opts: ChatOptions,
): AsyncIterable<ChatDelta> {
  const key = readKey(config);
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(buildBody(opts, true)),
    signal: opts.signal,
  });
  if (!res.ok) throw await toProviderError(config, res);
  if (!res.body) {
    throw new ProviderError(config.id, 502, `${config.id}: empty response body`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          buffer = "";
          break;
        }

        let chunk: WireChatResponse;
        try {
          chunk = JSON.parse(data) as WireChatResponse;
        } catch {
          continue; // partial/keepalive line — ignore
        }

        if (chunk.usage) usage = normalizeUsage(chunk.usage);

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          yield { type: "text", text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      id: v.id || `call_${i}`,
      type: "function",
      function: { name: v.name, arguments: v.args || "{}" },
    }));

  yield {
    type: "done",
    content: content.length > 0 ? content : null,
    toolCalls,
    usage,
    finishReason,
  };
}

/* -------------------------------------------------------------- embeddings */

async function embed(
  config: OpenAiCompatibleConfig,
  texts: string[],
  model: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = readKey(config);
  const res = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw await toProviderError(config, res);

  const json = (await res.json()) as WireEmbeddingResponse;
  // Re-order defensively: the spec preserves input order, but sort on `index`
  // so a permuted response can never misalign a vector with its source row.
  return [...(json.data ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/* ---------------------------------------------------------------- factory */

export function createOpenAiCompatibleAdapter(
  config: OpenAiCompatibleConfig,
): ProviderAdapter {
  function chat(opts: ChatOptions & { stream: true }): AsyncIterable<ChatDelta>;
  function chat(opts: ChatOptions & { stream?: false }): Promise<ChatResult>;
  function chat(
    opts: ChatOptions,
  ): AsyncIterable<ChatDelta> | Promise<ChatResult> {
    return opts.stream === true ? chatStream(config, opts) : chatOnce(config, opts);
  }

  return {
    id: config.id,
    chat,
    embed: (texts, model) => embed(config, texts, model),
  };
}
