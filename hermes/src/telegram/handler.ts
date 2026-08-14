import { enqueueKeyed } from "../lib/keyed-queue.js";
import { hermesDict, toLocale, DEFAULT_LOCALE, type Locale } from "../lib/i18n.js";
import { getAdminClient } from "../lib/supabase.js";
import { commandAllowed, roleMayUseBot } from "./access.js";
import {
  recallAttachment,
  rememberAttachment,
  safeMime,
  type PendingAttachment,
} from "./attachments.js";
import {
  answerCallbackQuery,
  editMessageText,
  escapeHtml,
  sendChatAction,
  sendMessage,
  type TelegramUpdate,
} from "./api.js";
import { handleCommand } from "./commands.js";
import { converse } from "../llm/converse.js";
import { buildHistory } from "../llm/history.js";
import { scrubText } from "../llm/redact.js";
import { env } from "../config/env.js";

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
  /** The chat's replay buffer, embedded in the same query. */
  conversationState: unknown;
  lastInboundAt: string | null;
}

async function findVerifiedChannel(chatId: number | string): Promise<Channel | null> {
  // The session is a one-to-one FK from hermes_sessions, so PostgREST can
  // embed it here — conversational memory costs no extra round trip.
  const { data } = await getAdminClient()
    .from("hermes_channels")
    // One string literal, deliberately: supabase-js infers the row shape from
    // the literal type, and a concatenated string degrades to `string` and
    // silently loses every column type.
    .select(
      "id, profile_id, verified, is_active, profiles:profile_id(role, status, locale), hermes_sessions(conversation_state, last_inbound_at)",
    )
    .eq("channel_type", "telegram")
    .eq("external_id", String(chatId))
    .maybeSingle();

  if (!data || !data.verified || !data.is_active) return null;
  const p = data.profiles as unknown as
    | { role?: string; status?: string; locale?: string }
    | null;
  if (p?.status !== "active" || !roleMayUseBot(p?.role)) return null;
  // The embed arrives as an array-of-at-most-one for a to-one relationship.
  const session = Array.isArray(data.hermes_sessions)
    ? data.hermes_sessions[0]
    : (data.hermes_sessions as { conversation_state?: unknown; last_inbound_at?: string } | null);

  return {
    id: data.id as string,
    profileId: data.profile_id as string,
    role: p!.role!,
    locale: toLocale(p.locale),
    conversationState: session?.conversation_state ?? null,
    lastInboundAt: session?.last_inbound_at ?? null,
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

/**
 * Insert the dedupe marker. Returns false when this update was already seen.
 *
 * Two things about `body`:
 *   * It is stored SCRUBBED, so the row holds the same bytes that would cross
 *     to a provider — the property `ai_messages` has, and the reason this log
 *     is safe to keep indefinitely.
 *   * The scrub applies to the STORED COPY ONLY. The caller's `text` must stay
 *     verbatim: a pairing code is `[A-Za-z0-9-]{6,64}` and can match the
 *     card/phone patterns, so scrubbing the working copy would silently break
 *     pairing. Dedupe keys on `update_id`, never on the body.
 *   * Nothing is stored for an unpaired sender. `markSeen` runs BEFORE the
 *     access check by design (a re-delivered pairing code must not re-run
 *     `tryPair`), so a stranger's words would otherwise be persisted forever
 *     for no operational reason.
 */
async function markSeen(
  update: TelegramUpdate,
  msgType: string,
): Promise<{ fresh: boolean; rowId: number | null }> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  const { data, error } = await getAdminClient()
    .from("hermes_messages")
    .insert({
      direction: "inbound",
      channel_type: "telegram",
      update_id: update.update_id,
      msg_type: msgType,
      chat_external_id: chatId === undefined ? null : String(chatId),
    })
    .select("id")
    .maybeSingle();

  if (!error) return { fresh: true, rowId: data?.id ?? null };
  if (error.code === "23505") return { fresh: false, rowId: null }; // duplicate delivery
  // Any other insert failure: log it, but still handle the update. Dropping a
  // real message is worse than risking a rare duplicate.
  console.warn("[telegram] dedupe insert failed:", error.message);
  return { fresh: true, rowId: null };
}

/**
 * Attach the body and the owner once the sender is known to be paired.
 *
 * Deliberately a second, un-awaited write rather than part of the insert: the
 * dedupe marker has to be committed BEFORE the access check (a re-delivered
 * pairing code must not re-run `tryPair`), and at that moment we do not yet
 * know who — or whether — this is. Splitting it means a stranger's words are
 * never written at all, and a colleague's are written scrubbed.
 */
function attachInboundBody(rowId: number | null, channelId: string, text: string): void {
  if (rowId === null) return;
  void getAdminClient()
    .from("hermes_messages")
    .update({ channel_id: channelId, body: scrubText(text).slice(0, 4000) })
    .eq("id", rowId)
    .then(
      () => undefined,
      () => undefined, // the reply matters; the log is best-effort
    );
}

/** Record what Hermes said. Best-effort, like the app's `persistMessage`. */
function recordReply(
  channelId: string,
  chatId: number | string,
  text: string,
  messageId: number | null,
): void {
  void getAdminClient()
    .from("hermes_messages")
    .insert({
      direction: "outbound",
      channel_type: "telegram",
      msg_type: "chat",
      body: scrubText(text).slice(0, 4000),
      chat_external_id: String(chatId),
      channel_id: channelId,
      external_message_id: messageId === null ? null : String(messageId),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

export async function processUpdate(update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (chatId === undefined) return;

  const isCallback = Boolean(update.callback_query);
  const text =
    update.message?.text ?? update.message?.caption ?? update.callback_query?.data ?? "";
  const seen = await markSeen(update, isCallback ? "callback" : "text");
  if (!seen.fresh) return;

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

    // Known sender: the message may now be attributed and its text kept.
    attachInboundBody(seen.rowId, channel.id, text);

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

    // An attached FILE is a first-class message now — Alina photographs a
    // passport and sends it with "паспорт Лены" as the caption. The file_id is
    // remembered per chat (15 min) so a follow-up answer ("it's her contract,
    // expires next June") can still file it; the id itself stays server-side
    // and the DOWNLOAD happens only after an Approve tap.
    const attachment = extractAttachment(update);
    if (attachment) {
      rememberAttachment(chatId, attachment);
    }
    const pending = recallAttachment(chatId);

    // A message with no text at all — a sticker, voice note, or a group
    // service event. Telegram delivers these as updates with no `text`, and
    // before this they hit the static command list for free; sending an empty
    // prompt to a provider would bill a round trip per sticker. A FILE with no
    // caption is the one exception: the model should ask whose it is.
    if (!text.trim() && !attachment) {
      await sendMessage(chatId, hermesDict(channel.locale).commandList);
      return;
    }

    // Free text from a verified member of senior staff — talk.
    await converse_(chatId, text, channel, seen.rowId, pending);
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
  inboundRowId: number | null,
  attachment?: PendingAttachment,
): Promise<void> {
  const h = hermesDict(channel.locale);

  // Replay whatever this chat was just talking about. `buildHistory` is pure
  // and fails open: an unreadable or expired state costs the bot its memory,
  // never an answer.
  const { messages: history, reset } = buildHistory({
    conversationState: channel.conversationState,
    lastInboundAt: channel.lastInboundAt,
    currentRole: channel.role,
    idleMinutes: env.HERMES_CHAT_IDLE_MIN,
  });

  // A placeholder sent NOW, then edited as the turn progresses. One message
  // that visibly evolves beats ten silent seconds and then a second message.
  // If it cannot be sent we simply fall back to answering with a new message —
  // the placeholder is decoration, the reply is not.
  let placeholderId: number | null = null;
  try {
    placeholderId = (await sendMessage(chatId, h.chatThinking)).message_id;
  } catch {
    placeholderId = null;
  }
  void sendChatAction(chatId, "typing").catch(() => undefined);

  // Telegram clears "typing…" after ~5s, so re-assert it for the duration.
  const typing = setInterval(() => {
    void sendChatAction(chatId, "typing").catch(() => undefined);
  }, 4_000);

  // Progress edits are throttled and de-duplicated: Telegram allows roughly
  // one message per second per chat and answers an identical edit with a 400.
  let lastShown = h.chatThinking;
  let lastEditAt = 0;
  const show = (next: string): void => {
    if (placeholderId === null || next === lastShown) return;
    if (Date.now() - lastEditAt < 3_000) return;
    lastShown = next;
    lastEditAt = Date.now();
    void editMessageText(chatId, placeholderId, next).catch(() => undefined);
  };

  try {
    const outcome = await converse({
      text,
      role: channel.role,
      locale: channel.locale,
      profileId: channel.profileId,
      chatId,
      history,
      attachment,
      onProgress: (stage) => {
        if (stage.kind === "thinking") return show(h.chatStillWorking);
        const label = stage.names
          .map((n) => h.chatTool[n])
          .find((l): l is string => Boolean(l));
        show(label ?? h.chatLookingUp);
      },
    });

    // Every outcome ends by REPLACING the placeholder. A path that forgets to
    // would leave "Thinking…" on screen as a permanent lie.
    const reply =
      outcome.kind === "answered"
        ? outcome.text
        : outcome.kind === "not_configured"
          ? h.chatNotConfigured
          : outcome.kind === "over_cap"
            ? h.chatOverCap
            : outcome.kind === "timed_out"
              ? h.chatTookTooLong
              : h.chatFailed;

    if (outcome.kind === "failed") {
      console.warn("[telegram] conversation failed:", outcome.error);
    }
    // Logged at info, not warn: a slow upstream is a condition, not a fault of
    // ours, and burying it in the same bucket as real failures is how the last
    // incident looked like a bug in the studio for twenty minutes.
    if (outcome.kind === "timed_out") {
      console.info("[telegram] conversation timed out:", outcome.reason);
    }

    // S8: a card this turn already sent is REAL and stays live. The failure
    // text must say so, or the person reads "something went wrong" directly
    // above a working Approve button and rephrases — queueing a second card.
    const withPendingNote =
      (outcome.kind === "failed" || outcome.kind === "timed_out") &&
      (outcome.pendingProposals ?? 0) > 0
        ? `${reply}\n\n${h.chatCardStillPending}`
        : reply;

    // Plain text on purpose: the model is told not to emit markup, and sending
    // unescaped model output as HTML would let a tool result's contents break
    // the message — or be crafted to.
    let sentId = placeholderId;
    if (placeholderId !== null) {
      try {
        await editMessageText(chatId, placeholderId, withPendingNote);
      } catch {
        // The one error path that must not lose the answer.
        sentId = (await sendMessage(chatId, withPendingNote).catch(() => null))?.message_id ?? null;
      }
    } else {
      sentId = (await sendMessage(chatId, withPendingNote).catch(() => null))?.message_id ?? null;
    }

    attachInboundBody(inboundRowId, channel.id, text);
    recordReply(channel.id, chatId, reply, sentId);

    // Only a real exchange is worth remembering. Storing an apology would have
    // the model treat it as its own prior answer next turn.
    if (outcome.kind === "answered") {
      void rememberTurn(channel, text, outcome.text, reset);
    }
  } finally {
    clearInterval(typing);
  }
}

/**
 * Append this exchange to the chat's replay buffer.
 *
 * The trimming rules live in `hermes_session_append` (028) — one statement, so
 * two workers overlapping during a redeploy cannot lose a turn. Both sides are
 * stored scrubbed: the state is replayed straight into the next provider call,
 * so raw text here would egress on turn 2 something turn 1 masked.
 */
function rememberTurn(
  channel: Channel,
  asked: string,
  answered: string,
  reset: boolean,
): void {
  void getAdminClient()
    .rpc("hermes_session_append", {
      p_channel_id: channel.id,
      p_user: scrubText(asked).slice(0, 2000),
      p_assistant: scrubText(answered).slice(0, 1200),
      p_role: channel.role,
      p_keep: env.HERMES_HISTORY_KEEP,
      p_idle_minutes: env.HERMES_CHAT_IDLE_MIN,
      p_reset: reset,
    })
    .then(
      () => undefined,
      (e: unknown) => console.warn("[telegram] memory write failed:", e),
    );
}

/* ------------------------------------------------------------ attachments --- */

function extractAttachment(
  update: TelegramUpdate,
): Omit<PendingAttachment, "receivedAt"> | null {
  const m = update.message;
  if (m?.document?.file_id) {
    return {
      fileId: m.document.file_id,
      fileName: m.document.file_name ?? "document",
      // Sender-controlled; shape-checked at the door (see attachments.ts).
      mimeType: safeMime(m.document.mime_type),
      sizeBytes: m.document.file_size ?? 0,
    };
  }
  // Photos arrive in ascending sizes; the last is the largest rendition, and
  // Telegram re-encodes photos to JPEG, so the mime is OURS, not the sender's.
  const photo = m?.photo?.[m.photo.length - 1];
  if (photo?.file_id) {
    return {
      fileId: photo.file_id,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: photo.file_size ?? 0,
    };
  }
  return null;
}
