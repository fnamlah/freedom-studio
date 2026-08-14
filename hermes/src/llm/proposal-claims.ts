/**
 * Detects a reply that CLAIMS an approval card was sent.
 *
 * Twice now the chat model has told a manager «Заявка отправлена — подтверди
 * в приложении» in a turn whose instrumentation reads `rounds=1 tools=0`: no
 * propose tool was called, no card exists, and the manager walks away believing
 * the studio recorded something it did not (operator Денис on 2026-08-14 14:10
 * and 14:39; the Sophie shift on 2026-08-14 18:07 — after the prompt already
 * said, in bold, never to do this). Prompt instructions demonstrably do not
 * hold the line, so converse.ts now holds it structurally: when a turn's final
 * text matches this detector but zero proposals were actually sent, the model
 * gets ONE corrective round to call the tool for real, and if it still
 * produces an unbacked claim the reply is replaced with an honest retraction.
 *
 * Pure module: no env, no imports — the false-positive cost is one extra
 * provider round, so the patterns lean toward recall. They require BOTH a
 * card-ish noun (заявка/карточка/предложение, card/proposal/request/approval)
 * AND a completed-action verb (отправлена/создана/оформлена…, sent/submitted/
 * created/filed) or the «ждёт подтверждения»/"awaiting approval" state claim,
 * within one sentence. Plain mentions — «нажми Approve на карточке выше»,
 * «я не могу одобрять заявки» — do not match.
 */

const SENTENCE = "[^.!?\\n]{0,80}";

const CLAIM_PATTERNS: RegExp[] = [
  // «Заявка … отправлена / создана / сформирована / оформлена / выслана»
  new RegExp(`(заявк|карточк|предложени)\\w*${SENTENCE}(отправл|созда|сформирова|оформл|высла|отосла)`, "i"),
  // «Отправил … заявку» (verb first)
  new RegExp(`(отправи|созда|сформирова|оформи|высла|отосла)\\w*${SENTENCE}(заявк|карточк|предложени)`, "i"),
  // «Карточка/заявка ждёт подтверждения» — the state claim without a send verb
  new RegExp(`(заявк|карточк)\\w*${SENTENCE}(ждёт|ждет|ожидает)${SENTENCE}подтвержд`, "i"),
  // "The card/proposal/request was sent / submitted / created / filed / raised"
  new RegExp(`(card|proposal|request|approval)${SENTENCE}\\b(sent|submitted|created|filed|raised)\\b`, "i"),
  new RegExp(`\\b(sent|submitted|created|filed|raised)\\b${SENTENCE}(card|proposal|request)`, "i"),
  new RegExp(`(card|proposal|request)${SENTENCE}awaiting${SENTENCE}(approval|confirmation)`, "i"),
];

export function claimsProposalSent(text: string): boolean {
  return CLAIM_PATTERNS.some((p) => p.test(text));
}

/**
 * The corrective system message. Model-facing, so English regardless of chat
 * locale. Deliberately repeats the tool-result condition verbatim from the
 * system prompt — the model is being shown the rule it just broke.
 */
export const REALITY_CHECK =
  "REALITY CHECK: your draft reply claims an approval card (заявка/карточка) was sent, " +
  "but you did NOT call any propose tool this turn — no card exists and nothing was recorded. " +
  "Do ONE of the following now: (1) call the correct hermes_propose_* tool with the details " +
  "already collected in this conversation, then confirm; or (2) reply honestly that the card " +
  "has NOT been sent yet and say what is still needed. Never state a card was sent unless a " +
  "tool result in THIS turn says awaiting_approval or already_waiting.";
