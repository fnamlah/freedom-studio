/**
 * Client-safe shared vocabulary for the AI chat surface (docs/11 §2).
 *
 * Pure types + pure helpers only — NO value imports from browser- or
 * server-only modules — so the streaming route may `import type` the
 * `SseEvent` union from here without dragging a client bundle into a server
 * handler. The browser Supabase reads live in the workspace component itself.
 */

import type { ProviderId } from "@/lib/ai/types";
import type { Dictionary } from "@/lib/i18n";

/** The SSE event stream the `/api/ai/chat` route emits, one JSON object per event. */
export type SseEvent =
  | { type: "conversation"; conversationId: string; title: string | null }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "not_configured"; provider: ProviderId | null }
  | { type: "error"; status: string; reason?: string }
  | {
      type: "done";
      status: "ok" | "rate_limited" | "budget_exceeded" | "not_configured" | "error";
      toolCalls: number;
    };

/** A conversation row as the sidebar needs it (own-only, docs/11 §2 [D11]). */
export interface ConversationLite {
  id: string;
  title: string | null;
  updated_at: string;
}

export type ChatViewRole = "user" | "assistant";

/** One rendered chat bubble. `tools` are the tool-call chips for an assistant turn. */
export interface ChatMessageView {
  key: string;
  role: ChatViewRole;
  content: string;
  tools: string[];
  /** True while the assistant reply is still streaming in. */
  pending?: boolean;
  /** Set when the turn ended in a refusal/error rather than an answer. */
  error?: string;
}

/** A raw `ai_messages` row shape as read by the browser client. */
export interface AiMessageRowLite {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_name: string | null;
  tool_args: unknown;
}

/** Product names — never translated (model + vendor). */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  moonshot: "Kimi K3 · Moonshot",
  zhipu: "GLM 5.2 · Zhipu",
};

type ToolLabels = Dictionary["adminAi"]["tools"];

/**
 * The chip label for a registry tool.
 *
 * The registry's tool NAMES are English snake_case identifiers, and the old
 * `earnings_summary → "Earnings summary"` title-casing could only ever produce
 * English. The dictionary carries a real label per tool instead; the title-case
 * path survives only as the fallback for a tool added to the registry before its
 * label — a chip reading `Some new tool` beats a blank one.
 */
export function prettyToolName(name: string, labels: ToolLabels): string {
  const label = labels[name as keyof ToolLabels];
  if (label) return label;
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Derive a conversation title from the first user message (server + client
 * agree). The title is the user's own words, so only the empty-message fallback
 * needs translating — passed in, since this module stays dictionary-free so the
 * streaming route can `import type` from it without pulling in a bundle.
 */
export function deriveTitle(message: string, emptyFallback: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return emptyFallback;
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

/**
 * Fold persisted `ai_messages` rows into rendered bubbles. Tool rows are
 * accumulated as chips onto the assistant turn they belong to; the empty
 * tool-call stub rows (content null, tool_args set) are dropped. Mirrors the
 * agent's persistence shape in `@/lib/ai/agent`.
 */
export function rowsToMessages(rows: AiMessageRowLite[]): ChatMessageView[] {
  const out: ChatMessageView[] = [];
  let pendingTools: string[] = [];

  for (const row of rows) {
    if (row.role === "tool") {
      if (row.tool_name) pendingTools.push(row.tool_name);
      continue;
    }
    if (row.role === "user") {
      if (typeof row.content === "string" && row.content.length > 0) {
        out.push({ key: `m${row.id}`, role: "user", content: row.content, tools: [] });
      }
      pendingTools = [];
      continue;
    }
    // assistant: only the rows that carry final text (tool-call stubs are skipped)
    if (typeof row.content === "string" && row.content.length > 0) {
      out.push({
        key: `m${row.id}`,
        role: "assistant",
        content: row.content,
        tools: pendingTools,
      });
      pendingTools = [];
    }
  }

  return out;
}

/** Parse an `text/event-stream` fetch response into typed `SseEvent`s. */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        const json = dataLine.slice(5).trim();
        if (json) {
          try {
            yield JSON.parse(json) as SseEvent;
          } catch {
            /* ignore malformed frame */
          }
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
