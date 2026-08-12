"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { ProviderId } from "@/lib/ai/types";

import {
  deriveTitle,
  prettyToolName,
  readSse,
  rowsToMessages,
  type AiMessageRowLite,
  type ChatMessageView,
  type ConversationLite,
} from "./ai-meta";

interface AiWorkspaceProps {
  initialConversations: ConversationLite[];
  aiConfigured: boolean;
  providerId: ProviderId;
  providerLabel: string;
}

/**
 * The AI chat workspace (docs/11 §2). Own-only conversation sidebar plus a
 * streaming chat client. Reads (conversation list, historical messages) use the
 * browser Supabase client under the caller's RLS; every turn is a POST to
 * `/api/ai/chat` whose SSE stream this component consumes — the browser holds no
 * provider key or prompt-assembly logic that matters for security.
 */
export function AiWorkspace({
  initialConversations,
  aiConfigured,
  providerId,
  providerLabel,
}: AiWorkspaceProps) {
  const { error: toastError } = useToast();
  const supabase = useRef(createBrowserSupabase());

  const [conversations, setConversations] =
    useState<ConversationLite[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notConfigured, setNotConfigured] = useState(!aiConfigured);
  const [downProvider, setDownProvider] = useState<ProviderId>(providerId);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the transcript pinned to the newest message as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patchMessage = useCallback(
    (key: string, updater: (m: ChatMessageView) => ChatMessageView) => {
      setMessages((prev) => prev.map((m) => (m.key === key ? updater(m) : m)));
    },
    [],
  );

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setMessages([]);
    setLoadingHistory(true);
    const { data } = await supabase.current
      .from("ai_messages")
      .select("id, role, content, tool_name, tool_args")
      .eq("conversation_id", id)
      .order("id", { ascending: true });
    setMessages(rowsToMessages((data ?? []) as AiMessageRowLite[]));
    setLoadingHistory(false);
  }, []);

  const startNewChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setInput("");
  }, []);

  const bumpConversation = useCallback(
    (id: string, title: string | null) => {
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === id);
        const now = new Date().toISOString();
        const next: ConversationLite = existing
          ? { ...existing, updated_at: now }
          : { id, title, updated_at: now };
        return [next, ...prev.filter((c) => c.id !== id)];
      });
    },
    [],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || sending || notConfigured) return;

    const userKey = `u-${Date.now()}`;
    const assistantKey = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { key: userKey, role: "user", content: text, tools: [] },
      { key: assistantKey, role: "assistant", content: "", tools: [], pending: true },
    ]);
    setInput("");
    setSending(true);

    // Optimistically float the active conversation to the top of the sidebar.
    if (activeId) bumpConversation(activeId, null);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId ?? undefined, message: text }),
      });

      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok && !contentType.includes("text/event-stream")) {
        // AuthzError / 400 / 404 / 500 — a plain JSON error body.
        let messageText = "The assistant is unavailable right now.";
        if (response.status === 404) messageText = "That conversation could not be found.";
        try {
          const errBody = (await response.json()) as {
            error?: { message?: string };
            configured?: boolean;
          };
          if (errBody?.configured === false) {
            setNotConfigured(true);
            patchMessage(assistantKey, (m) => ({ ...m, pending: false, error: NOT_CONFIGURED }));
            return;
          }
          if (errBody?.error?.message) messageText = errBody.error.message;
        } catch {
          /* keep default */
        }
        patchMessage(assistantKey, (m) => ({ ...m, pending: false, error: messageText }));
        toastError(messageText);
        return;
      }

      for await (const event of readSse(response)) {
        switch (event.type) {
          case "conversation": {
            if (!activeId) setActiveId(event.conversationId);
            bumpConversation(
              event.conversationId,
              event.title ?? deriveTitle(text),
            );
            break;
          }
          case "delta": {
            patchMessage(assistantKey, (m) => ({ ...m, content: m.content + event.text }));
            break;
          }
          case "tool": {
            patchMessage(assistantKey, (m) => ({ ...m, tools: [...m.tools, event.name] }));
            break;
          }
          case "not_configured": {
            setNotConfigured(true);
            if (event.provider) setDownProvider(event.provider);
            patchMessage(assistantKey, (m) => ({ ...m, pending: false, error: NOT_CONFIGURED }));
            break;
          }
          case "error": {
            const reason =
              event.status === "rate_limited"
                ? event.reason ?? "You have hit the hourly request limit. Try again soon."
                : event.status === "budget_exceeded"
                  ? event.reason ?? "The token budget for this window is exhausted."
                  : event.reason ?? "The assistant hit an error.";
            patchMessage(assistantKey, (m) => ({ ...m, pending: false, error: reason }));
            toastError(reason);
            break;
          }
          case "done": {
            patchMessage(assistantKey, (m) => ({
              ...m,
              pending: false,
              error:
                m.content.length === 0 && !m.error
                  ? "The assistant returned no answer."
                  : m.error,
            }));
            break;
          }
        }
      }
    } catch {
      const msg = "The connection to the assistant was interrupted.";
      patchMessage(assistantKey, (m) => ({ ...m, pending: false, error: msg }));
      toastError(msg);
    } finally {
      setSending(false);
    }
  }, [activeId, bumpConversation, input, notConfigured, patchMessage, sending, toastError]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const bannerProvider = notConfigured ? downProvider : providerId;

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[520px] gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside className="flex max-h-48 min-h-0 min-w-0 flex-col rounded-lg border border-border bg-surface md:max-h-none">
        <div className="border-b border-border p-3">
          <Button fullWidth size="sm" variant="secondary" onClick={startNewChat}>
            New chat
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted">
              No conversations yet. Ask the assistant a question to begin.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void loadConversation(c.id)}
                    className={cn(
                      "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors",
                      c.id === activeId
                        ? "bg-primary/15 text-foreground"
                        : "text-muted hover:bg-surface-2 hover:text-foreground",
                    )}
                    title={c.title ?? "Untitled chat"}
                  >
                    {c.title ?? "Untitled chat"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      {/* Chat pane */}
      <section className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-surface">
        {notConfigured ? (
          <div className="border-b border-border bg-warning/10 px-4 py-2.5 text-xs text-foreground">
            <span className="font-medium text-warning">AI provider not configured</span>{" "}
            — add{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">
              {bannerProvider === "moonshot" ? "MOONSHOT_API_KEY" : "ZHIPU_API_KEY"}
            </code>{" "}
            (or the other provider&apos;s key) in Vercel, then switch the active
            provider in Admin → Settings.
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted">
            <span>Answers come from your own RLS-scoped data — aggregates only.</span>
            <Badge variant="muted" dot>
              {providerLabel}
            </Badge>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {loadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                bare
                title="Ask about the studio's numbers"
                description="Earnings, hours, payouts, balances, forecasts, compliance — the assistant reads only what you can, and only in aggregate. Try: “Top earners by net last month.”"
              />
            </div>
          ) : (
            <ul className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m) => (
                <li key={m.key}>
                  <MessageBubble message={m} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={notConfigured}
              placeholder={
                notConfigured
                  ? "AI is not configured."
                  : "Ask a question… (Enter to send, Shift+Enter for a new line)"
              }
              className="max-h-40 min-h-[42px] resize-none"
            />
            <Button
              onClick={() => void send()}
              loading={sending}
              disabled={notConfigured || input.trim().length === 0}
            >
              Send
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

const NOT_CONFIGURED = "AI provider not configured.";

function MessageBubble({ message }: { message: ChatMessageView }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      {message.tools.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {message.tools.map((tool, i) => (
            <Badge key={`${tool}-${i}`} variant="primary">
              {prettyToolName(tool)}
            </Badge>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary/15 text-foreground"
            : "border border-border bg-surface-2 text-foreground",
        )}
      >
        {message.content.length > 0 ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : message.pending ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Spinner size="sm" /> Thinking…
          </span>
        ) : null}

        {message.error ? (
          <p
            className={cn(
              "text-xs text-warning",
              message.content.length > 0 ? "mt-1.5" : "",
            )}
          >
            {message.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
