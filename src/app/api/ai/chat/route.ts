/**
 * POST /api/ai/chat — the AI chat gateway (docs/11 §2).
 *
 * SERVER-ONLY streaming route. It is the browser's ONLY door to the assistant:
 * the client never holds a provider key or URL. Per request it
 *   1. gates on role — Super Admin, Manager, Finance only (docs/11 §2 [D10]),
 *      via `guardedAdminClient`, which throws `AuthzError` on failure AND hands
 *      back the service-role client the agent needs for `ai_usage` metering and
 *      the GLOBAL budget window (docs/11 §8);
 *   2. loads/creates an OWN-ONLY conversation (docs/11 §2 [D11]) under the
 *      caller's RLS-scoped client;
 *   3. hands the transcript to `runAgentTurn`, which runs the tool loop under
 *      the caller's RLS, redacts every provider-bound byte, persists the
 *      redacted `ai_messages`, and meters `ai_usage` itself;
 *   4. streams the assistant deltas + tool-call chips back over SSE.
 *
 * Graceful degradation: when the active provider has no key the agent returns
 * status `not_configured` and we stream a single `not_configured` event over an
 * HTTP-200 body so the UI shows the "add MOONSHOT_API_KEY/ZHIPU_API_KEY" banner
 * (docs/11 §1 non-negotiable 4). Rate-limit / budget refusals stream an `error`
 * event carrying the reason — refusals are still metered by the agent.
 */

import { getActiveProviderId } from "@/lib/ai/provider";
import { runAgentTurn } from "@/lib/ai/agent";
import type { ChatMessage } from "@/lib/ai/types";
import { guardedAdminClient } from "@/lib/supabase/admin";
import { isAuthzError } from "@/lib/auth/errors";
import { dict, toLocale, type Locale } from "@/lib/i18n";
import { createRouteSupabase } from "@/lib/supabase/server";

import { deriveTitle, type SseEvent } from "../../../(app)/ai/ai-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_ROLES = ["super_admin", "manager", "finance"] as const;

function jsonError(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  // 1. Role + AAL2 gate. `guardedAdminClient` enforces the same super_admin /
  //    manager / finance membership AND yields the service-role client the agent
  //    needs; `requireApiRole` is redundant with it, so one guard covers both.
  //
  //    The guard also hands back the caller's `profile`, whose `locale`
  //    (migration 019) decides BOTH the language of the error bodies below and —
  //    the point of the whole surface — the language the assistant answers in.
  //    Taken from the profile already loaded rather than from `getLocale()`,
  //    which would re-query for a value we are holding.
  let service;
  let userId: string;
  let locale: Locale;
  try {
    const ctx = await guardedAdminClient([...AI_ROLES]);
    service = ctx.admin;
    userId = ctx.user.id;
    locale = toLocale(ctx.profile.locale);
  } catch (e) {
    if (isAuthzError(e)) return jsonError(e.toResponseBody(), e.status);
    throw e;
  }
  const d = dict(locale).adminAi.assistant;

  // The caller's RLS-scoped client — tools + own-only conversation/message reads.
  const supabase = await createRouteSupabase();

  // 2. Parse the request body.
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError(
      { error: { code: "bad_request", message: d.errBodyNotJson } },
      400,
    );
  }
  const body = (payload ?? {}) as { conversationId?: unknown; message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) {
    return jsonError(
      { error: { code: "bad_request", message: d.errMessageRequired } },
      400,
    );
  }
  const requestedConversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : null;

  // 3. Resolve the conversation, own-only. RLS makes a foreign conversation
  //    read as absent → 404 rather than a leak (docs/11 §2 [D11]).
  let conversationId: string;
  let conversationTitle: string | null;
  if (requestedConversationId) {
    const { data: convo, error } = await supabase
      .from("ai_conversations")
      .select("id, title")
      .eq("id", requestedConversationId)
      .maybeSingle();
    if (error) {
      return jsonError(
        { error: { code: "server_error", message: d.errLoadConversation } },
        500,
      );
    }
    if (!convo) {
      return jsonError(
        { error: { code: "not_found", message: d.errConversationNotFound } },
        404,
      );
    }
    conversationId = convo.id;
    conversationTitle = convo.title;
  } else {
    conversationTitle = deriveTitle(message, d.newChat);
    const { data: created, error } = await supabase
      .from("ai_conversations")
      .insert({ user_id: userId, title: conversationTitle })
      .select("id, title")
      .single();
    if (error || !created) {
      return jsonError(
        { error: { code: "server_error", message: d.errCreateConversation } },
        500,
      );
    }
    conversationId = created.id;
    conversationTitle = created.title;
  }

  // 4. Load prior turns for context (own-only). We reconstruct only clean
  //    user/assistant text — the tool-call stubs and redacted tool rows are
  //    egress-audit artifacts, not needed to continue the conversation, and
  //    re-feeding them risks provider tool-call linkage errors.
  const { data: historyRows } = await supabase
    .from("ai_messages")
    .select("id, role, content, tool_args")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: true });

  const history: ChatMessage[] = (historyRows ?? [])
    .filter(
      (r) =>
        (r.role === "user" || r.role === "assistant") &&
        typeof r.content === "string" &&
        r.content.length > 0 &&
        r.tool_args == null,
    )
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content as string }));

  const preMaxId =
    historyRows && historyRows.length > 0
      ? historyRows[historyRows.length - 1].id
      : 0;

  const messages: ChatMessage[] = [...history, { role: "user", content: message }];

  // Provider id up front for a clean `not_configured` event (no key check here).
  const activeProvider = await getActiveProviderId();

  // 5. Stream the turn over SSE.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // First frame carries the (possibly new) conversation id so the client can
      // adopt it for the sidebar and the next turn.
      send({ type: "conversation", conversationId, title: conversationTitle });

      try {
        const result = await runAgentTurn({
          messages,
          userId,
          supabase,
          service,
          conversationId,
          onDelta: (text) => send({ type: "delta", text }),
          locale,
          signal: req.signal,
        });

        if (result.status === "not_configured") {
          send({ type: "not_configured", provider: activeProvider });
        } else if (
          result.status === "rate_limited" ||
          result.status === "budget_exceeded" ||
          result.status === "error"
        ) {
          send({ type: "error", status: result.status, reason: result.reason });
        }

        // Surface the tool-call chips: the redacted `tool` rows the agent just
        // persisted for THIS turn (id-diff, own-only).
        if (result.toolCallsCount > 0) {
          const { data: toolRows } = await supabase
            .from("ai_messages")
            .select("tool_name")
            .eq("conversation_id", conversationId)
            .eq("role", "tool")
            .gt("id", preMaxId)
            .order("id", { ascending: true });
          for (const row of toolRows ?? []) {
            if (row.tool_name) send({ type: "tool", name: row.tool_name });
          }
        }

        send({ type: "done", status: result.status, toolCalls: result.toolCallsCount });
      } catch (e) {
        send({
          type: "error",
          status: "error",
          reason: e instanceof Error ? e.message : d.errRequestFailed,
        });
        send({ type: "done", status: "error", toolCalls: 0 });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
