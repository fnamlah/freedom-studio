import { env } from "../config/env.js";
import { hermesDict, type Locale } from "../lib/i18n.js";

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
): Promise<TelegramMessage> {
  return call<TelegramMessage>("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, HARD_LIMIT),
    ...(opts.html ? { parse_mode: "HTML" } : {}),
    disable_web_page_preview: true,
  });
}

/**
 * Replace the text of a message already sent.
 *
 * This is how a conversational turn shows its work: one placeholder is sent
 * immediately and then edited — "looking that up…" → the answer — rather than
 * leaving the chat silent for ten seconds and then posting a second message.
 *
 * Telegram answers a byte-identical edit with 400 "message is not modified",
 * which `call` would throw on. Callers dedupe on the last text they sent; this
 * swallows that one description as a backstop so a cosmetic race can never
 * cost anyone their answer.
 */
export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  opts: { html?: boolean } = {},
): Promise<void> {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, HARD_LIMIT),
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      disable_web_page_preview: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not modified/i.test(message)) return;
    throw e;
  }
}

/**
 * The "typing…" indicator. A conversational turn can take several seconds
 * while a tool round trip runs, and without this the chat looks dead. Telegram
 * clears it automatically after ~5s or when the next message arrives, so it is
 * fired once per turn and never cancelled.
 */
export function sendChatAction(
  chatId: number | string,
  action: "typing" = "typing",
): Promise<unknown> {
  return call("sendChatAction", { chat_id: chatId, action });
}

/**
 * An approval card. The callback payload is `appr:<uuid>:approve|reject` — the
 * same scheme the in-app page decides through, so both surfaces converge on
 * one `decide_approval` call.
 *
 * Argument order is (id, summary): both are strings, so a swapped call site
 * typechecks and then ships a card whose Approve button carries the message
 * text as its callback payload — Telegram rejects it (64-byte limit) and the
 * card never renders. Both existing callers pass the id second; the signature
 * now matches them, and the UUID check below catches any future swap at run
 * time instead of in production silence.
 */
export function sendApprovalCard(
  chatId: number | string,
  approvalId: string,
  summary: string,
  locale: Locale,
): Promise<unknown> {
  if (!/^[0-9a-fA-F-]{36}$/.test(approvalId)) {
    throw new Error(`sendApprovalCard: approvalId is not a uuid (got ${approvalId.slice(0, 40)})`);
  }
  return call("sendMessage", {
    chat_id: chatId,
    text: summary.slice(0, 3800),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          // Button LABELS are localized; the callback payload is not — it is a
          // machine contract parsed by APPR_RE in handler.ts.
          { text: hermesDict(locale).approve, callback_data: `appr:${approvalId}:approve` },
          { text: hermesDict(locale).reject, callback_data: `appr:${approvalId}:reject` },
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
  languageCode?: string,
): Promise<unknown> {
  // Telegram scopes the command menu by the CLIENT's language, which is not the
  // same thing as our profile locale — so we register both lists and let the
  // app pick. Omitting language_code sets the default (English) list.
  return call("setMyCommands", {
    commands,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}
