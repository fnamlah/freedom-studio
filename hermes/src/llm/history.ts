import type { ChatMessage } from "./provider.js";

/**
 * Turning a stored conversation back into provider messages.
 *
 * PURE — no env, no database — so `governance.test.ts` can pin its behaviour
 * without booting anything, the same reason `tool-catalog.ts` is split from
 * `tools.ts`.
 *
 * The invariant this module exists to hold: a replayed history contains ONLY
 * `user` and `assistant` prose. Never a `tool` message, never an assistant
 * message carrying `tool_calls`. The app learned this the hard way and has to
 * filter its own log on replay (`src/app/api/ai/chat/route.ts`: re-feeding a
 * tool stub "risks provider tool-call linkage errors"). Here the STORED SHAPE
 * is pairs, so a tool stub cannot be represented, let alone replayed — but the
 * parser below is still defensive, because the row is jsonb and jsonb is
 * whatever was last written to it.
 *
 * Everything fails OPEN to an empty history: a malformed or unknown-version
 * state costs the bot its memory, which is a bad answer, not a leak.
 */

export type StoredTurn = { user: string; assistant: string; at: string };

export interface ConversationState {
  v: number;
  role: string;
  turns: StoredTurn[];
}

/** Characters of replayed history. Beyond this, cost and latency stop paying. */
const MAX_HISTORY_CHARS = 6000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse `conversation_state`. Returns [] for anything unrecognised — including
 * a future `v`, which an older worker must not try to interpret.
 */
export function parseState(raw: unknown, currentRole: string): StoredTurn[] {
  if (!isRecord(raw)) return [];
  if (raw.v !== 1) return [];
  // The stored prose was produced for a role's entitlements. If the person's
  // role has changed since, none of it may be replayed to them.
  if (typeof raw.role === "string" && raw.role !== currentRole) return [];
  if (!Array.isArray(raw.turns)) return [];

  const turns: StoredTurn[] = [];
  for (const t of raw.turns) {
    if (!isRecord(t)) continue;
    const { user, assistant, at } = t;
    if (typeof user !== "string" || typeof assistant !== "string") continue;
    if (!user.trim() || !assistant.trim()) continue;
    turns.push({ user, assistant, at: typeof at === "string" ? at : "" });
  }
  return turns;
}

/** True when the gap since the human last spoke starts a new conversation. */
export function isIdleExpired(
  lastInboundAt: string | null | undefined,
  idleMinutes: number,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return true;
  const t = Date.parse(lastInboundAt);
  if (Number.isNaN(t)) return true;
  return now - t > idleMinutes * 60_000;
}

/**
 * Drop whole pairs from the OLDEST end until the replay fits the budget.
 *
 * Whole pairs, always: replaying a question without its answer invites the
 * model to answer it a second time.
 */
export function withinBudget(turns: StoredTurn[], maxChars = MAX_HISTORY_CHARS): StoredTurn[] {
  const kept: StoredTurn[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const size = turn.user.length + turn.assistant.length;
    if (total + size > maxChars) break;
    total += size;
    kept.unshift(turn);
  }
  return kept;
}

/**
 * The replay itself. Pairs become alternating user/assistant messages — the
 * only two roles that ever come out of storage.
 */
export function toMessages(turns: StoredTurn[]): ChatMessage[] {
  return withinBudget(turns).flatMap((t) => [
    { role: "user" as const, content: t.user },
    { role: "assistant" as const, content: t.assistant },
  ]);
}

/**
 * Everything a caller needs from a stored session, in one call: parse, expire,
 * budget, and render.
 */
export function buildHistory(input: {
  conversationState: unknown;
  lastInboundAt: string | null | undefined;
  currentRole: string;
  idleMinutes: number;
  now?: number;
}): { messages: ChatMessage[]; reset: boolean } {
  const expired = isIdleExpired(input.lastInboundAt, input.idleMinutes, input.now);
  if (expired) return { messages: [], reset: true };

  const turns = parseState(input.conversationState, input.currentRole);
  // A parse that yields nothing where something was stored means the thread is
  // not continuable — tell the writer to start clean rather than append onto
  // state it could not read.
  const reset = turns.length === 0;
  return { messages: toMessages(turns), reset };
}
