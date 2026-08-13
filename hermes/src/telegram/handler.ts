import { enqueueKeyed } from "../lib/keyed-queue.js";
import { hermesDict, toLocale, DEFAULT_LOCALE, type Locale } from "../lib/i18n.js";
import { getAdminClient } from "../lib/supabase.js";
import { commandAllowed, roleMayUseBot } from "./access.js";
import {
  answerCallbackQuery,
  escapeHtml,
  sendChatAction,
  sendMessage,
  type TelegramUpdate,
} from "./api.js";
import { handleCommand } from "./commands.js";
import { converse } from "../llm/converse.js";

/**
 * Telegram update dispatch.
 *
 * Three properties matter here, in order:
 *  1. ACCESS — a chat is ignored entirely unless it is verified AND bound to an
 *     active staff profile whose role may use the bot (access.ts). Unpaired
 *     chats can do exactly one thing: redeem a pairing code — and a code minted
 *     for a named person redeems only from that person's Telegram username.
 *     Everything else is met with silence, not an error message (an error
 *     message confirms the bot exists to whoever found it).
 *  2. IDEMPOTENCE — Telegram re-delivers on network hiccups. The update_id is
 *     inserted first and a unique violation short-circuits the turn.
 *  3. ORDERING — updates for one chat are serialized.
 *
 * Deciding an approval is deliberately NOT gated in this file: the callback
 * relays to `decide_approval`, which re-reads the actor's role in the database
 * per decision. The role checks here choose what to show, never what to allow.
 */

const APPR_RE = /^appr:([0-9a-fA-F-]{36}):(approve|reject)$/;

interface Channel {
  id: string;
  profileId: string;
  role: string;
  locale: Locale;
}

async function findVerifiedChannel(chatId: number | string): Promise<Channel | null> {
  const { data } = await getAdminClient()
    .from("hermes_channels")
    .select("id, profile_id, verified, is_active, profiles:profile_id(role, status, locale)")
    .eq("channel_type", "telegram")
    .eq("external_id", String(chatId))
    .maybeSingle();

  if (!data || !data.verified || !data.is_active) return null;
  const p = data.profiles as unknown as
    | { role?: string; status?: string; locale?: string }
    | null;
  if (p?.status !== "active" || !roleMayUseBot(p?.role)) return null;
  return {
    id: data.id as string,
    profileId: data.profile_id as string,
    role: p!.role!,
    locale: toLocale(p.locale),
  };
}

/** Redeem a one-time pairing code. The only action an unpaired chat may take. */
async function tryPair(
  chatId: number | string,
  text: string,
  senderUsername: string | undefined,
): Promise<boolean> {
  const code = text.trim();
  if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) return false;

  const db = getAdminClient();
  const { data: row } = await db
    .from("hermes_pairing_codes")
    .select("code, profile_id, expires_at, used_at, expected_username, profiles:profile_id(role, status, locale)")
    .eq("code", code)
    .maybeSingle();

  if (!row || row.used_at || Date.parse(String(row.expires_at)) < Date.now()) return false;
  const p = row.profiles as unknown as
    | { role?: string; status?: string; locale?: string }
    | null;
  if (p?.status !== "active" || !roleMayUseBot(p?.role)) return false;

  // A code minted for a named person redeems only from that username. The
  // comparison is silent on mismatch: telling a stranger "wrong account" tells
  // them the code is real.
  if (row.expected_username) {
    const want = String(row.expected_username).replace(/^@/, "").toLowerCase();
    const got = (senderUsername ?? "").replace(/^@/, "").toLowerCase();
    if (!got || got !== want) return false;
  }

  await db
    .from("hermes_channels")
    .upsert(
      {
        channel_type: "telegram",
        external_id: String(chatId),
        profile_id: row.profile_id,
        verified: true,
        is_active: true,
      },
      { onConflict: "channel_type,external_id" },
    );
  await db.from("hermes_pairing_codes").update({ used_at: new Date().toISOString() }).eq("code", code);

  // The confirmation is the first thing this person ever sees from the bot —
  // it must already be in their language, not the deployment default.
  await sendMessage(chatId, hermesDict(toLocale(p.locale)).paired);
  return true;
}

/** Insert the dedupe marker. Returns false when this update was already seen. */
async function markSeen(update: TelegramUpdate, body: string, msgType: string): Promise<boolean> {
  const { error } = await getAdminClient().from("hermes_messages").insert({
    direction: "inbound",
    channel_type: "telegram",
    update_id: update.update_id,
    msg_type: msgType,
    body: body.slice(0, 4000),
  });
  if (!error) return true;
  if (error.code === "23505") return false; // duplicate delivery
  // Any other insert failure: log it, but still handle the update. Dropping a
  // real message is worse than risking a rare duplicate.
  console.warn("[telegram] dedupe insert failed:", error.message);
  return true;
}

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (chatId === undefined) return;

  const isCallback = Boolean(update.callback_query);
  const text = update.message?.text ?? update.callback_query?.data ?? "";
  if (!(await markSeen(update, text, isCallback ? "callback" : "text"))) return;

  await enqueueKeyed(`chat:${chatId}`, async () => {
    const channel = await findVerifiedChannel(chatId);

    if (!channel) {
      // Unpaired: only a pairing code is accepted. /start gets a hint; anything
      // else is met with silence.
      if (!isCallback && text && !text.startsWith("/")) {
        if (await tryPair(chatId, text, update.message?.from?.username)) return;
      }
      if (text === "/start") {
        await sendMessage(chatId, hermesDict(DEFAULT_LOCALE).sendPairingCode);
      }
      return;
    }

    if (isCallback && update.callback_query) {
      await handleApprovalCallback(
        update.callback_query.id,
        text,
        channel.profileId,
        chatId,
        channel.locale,
      );
      return;
    }

    if (text.startsWith("/")) {
      const command = text.toLowerCase().split(/[\s@]/)[0] ?? "";
      if (!commandAllowed(channel.role, command)) {
        await sendMessage(chatId, hermesDict(channel.locale).needsSuperAdmin);
        return;
      }
      const handled = await handleCommand({
        command,
        chatId,
        profileId: channel.profileId,
        role: channel.role,
        locale: channel.locale,
        text,
      });
      if (handled) return;

      // An unrecognised command is a typo, not a question. Show the list
      // rather than paying for a provider turn to guess at "/blaance" — and
      // this is the only thing that keeps the command list discoverable now
      // that free text goes to the model.
      await sendMessage(chatId, hermesDict(channel.locale).commandList);
      return;
    }

    // A message with no text at all — a sticker, photo, voice note, or a group
    // service event. Telegram delivers these as updates with no `text`, and
    // before this they hit the static command list for free; sending an empty
    // prompt to a provider would bill a round trip per sticker.
    if (!text.trim()) {
      await sendMessage(chatId, hermesDict(channel.locale).commandList);
      return;
    }

    // Free text from a verified member of senior staff — talk.
    await converse_(chatId, text, channel);
  });
}

/**
 * An approval decision from a button tap. The service role relays it, but the
 * decision itself goes through `decide_approval`, which re-checks the actor's
 * role in the database — the trigger guarantees no other path can set the state.
 */
async function handleApprovalCallback(
  callbackId: string,
  data: string,
  profileId: string,
  chatId: number | string,
  locale: Locale,
): Promise<void> {
  const h = hermesDict(locale);
  const match = APPR_RE.exec(data);
  const approvalId = match?.[1];
  const verdict = match?.[2];
  if (!approvalId || !verdict) {
    await answerCallbackQuery(callbackId, h.unrecognisedAction);
    return;
  }

  const { error } = await getAdminClient().rpc("decide_approval", {
    p_id: approvalId,
    p_verdict: verdict,
    p_actor: profileId,
    p_via: "telegram",
  });

  if (error) {
    await answerCallbackQuery(callbackId, h.decisionNotRecorded);
    await sendMessage(chatId, h.decisionFailed(escapeHtml(error.message)));
    return;
  }

  await answerCallbackQuery(callbackId, verdict === "approve" ? h.approved : h.rejected);

  if (verdict === "approve") {
    const { executeApproval } = await import("../governance/approvals.js");
    const result = await executeApproval(approvalId, locale);
    await sendMessage(chatId, result.ok ? `✅ ${result.message}` : `⚠️ ${result.message}`);
  } else {
    await sendMessage(chatId, h.rejectedNothingRan);
  }
}

/**
 * Answer free text.
 *
 * Every failure mode degrades to a sentence in the asker's language rather
 * than silence: a bot that ignores you is indistinguishable from a broken one,
 * and this is the surface staff will actually use.
 *
 * `sendChatAction` is fired first because a tool round trip takes a few
 * seconds and a typing indicator is the difference between "thinking" and
 * "dead". It is best-effort — a failed indicator must not cost us the reply.
 */
async function converse_(
  chatId: number | string,
  text: string,
  channel: Channel,
): Promise<void> {
  const h = hermesDict(channel.locale);
  await sendChatAction(chatId, "typing").catch(() => undefined);

  const outcome = await converse({
    text,
    role: channel.role,
    locale: channel.locale,
    profileId: channel.profileId,
  });

  switch (outcome.kind) {
    case "answered":
      // Plain text on purpose: the model is told not to emit markup, and
      // sending unescaped model output as HTML would let a tool result's
      // contents break the message — or worse, be crafted to.
      await sendMessage(chatId, outcome.text);
      return;
    case "not_configured":
      await sendMessage(chatId, h.chatNotConfigured);
      return;
    case "over_cap":
      await sendMessage(chatId, h.chatOverCap);
      return;
    case "failed":
      console.warn("[telegram] conversation failed:", outcome.error);
      await sendMessage(chatId, h.chatFailed);
      return;
  }
}
