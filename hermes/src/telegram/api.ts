import { env } from "../config/env.js";

/**
 * Raw Telegram Bot API over `fetch`. No framework: the surface we need is four
 * methods, and a dependency here would be more code than the code.
 */

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: { id: number; username?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from?: { id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

const HARD_LIMIT = 4096;

async function call<T>(method: string, body: unknown, retried = false): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const res = await fetch(`${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
    parameters?: { retry_after?: number };
  };

  if (!json.ok) {
    // Honour a rate-limit hint exactly once, then surface the failure.
    if (res.status === 429 && !retried) {
      const wait = Math.min(json.parameters?.retry_after ?? 1, 60);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return call<T>(method, body, true);
    }
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

/**
 * Escape before interpolating ANY value into an HTML message. An unescaped
 * name renders attacker-controlled markup next to a one-tap Approve button.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function getUpdates(offset: number, timeoutSec = 25): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>("getUpdates", { offset, timeout: timeoutSec });
}

export function sendMessage(
  chatId: number | string,
  text: string,
  opts: { html?: boolean } = {},
): Promise<unknown> {
  return call("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, HARD_LIMIT),
    ...(opts.html ? { parse_mode: "HTML" } : {}),
    disable_web_page_preview: true,
  });
}

/**
 * An approval card. The callback payload is `appr:<uuid>:approve|reject` — the
 * same scheme the in-app page decides through, so both surfaces converge on
 * one `decide_approval` call.
 */
export function sendApprovalCard(
  chatId: number | string,
  summary: string,
  approvalId: string,
): Promise<unknown> {
  return call("sendMessage", {
    chat_id: chatId,
    text: summary.slice(0, 3800),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `appr:${approvalId}:approve` },
          { text: "✕ Reject", callback_data: `appr:${approvalId}:reject` },
        ],
      ],
    },
  });
}

export function answerCallbackQuery(id: string, text?: string): Promise<unknown> {
  return call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

export function setMyCommands(
  commands: Array<{ command: string; description: string }>,
): Promise<unknown> {
  return call("setMyCommands", { commands });
}
