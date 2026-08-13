import { alertOwner } from "../lib/owner.js";
import { getPolicyValue, isEnabled, setPolicyValue } from "../lib/policy-kv.js";
import { inFlight, isStopping, stoppableSleep, trackDrain } from "../lib/shutdown.js";
import { getUpdates } from "../telegram/api.js";
import { processUpdate } from "../telegram/handler.js";

/**
 * Long-polling Telegram consumer.
 *
 * Polling rather than webhooks: it needs no public URL, no secret rotation and
 * no inbound surface on the studio's domain. The offset is persisted after
 * EVERY update so a crash resumes exactly where it stopped rather than
 * replaying a batch.
 *
 * This does not use `runLoop` because it needs two distinct error classes: a
 * 409 (another poller briefly alive during a deploy cutover) self-heals and
 * must not page anyone, while a real error should back off and alert.
 */

const OFFSET_KEY = "telegram_offset";
const CONFLICT_ALERT_AFTER = 20;

/** Concurrent turns. Each one holds a provider socket and costs money. */
const MAX_CONCURRENT_TURNS = 4;

export async function runTelegramPoller(): Promise<void> {
  let offset = (await getPolicyValue<number>(OFFSET_KEY)) ?? 0;
  let conflicts = 0;
  let errors = 0;
  let lastHeartbeat = 0;

  console.info(`[telegram] polling from offset ${offset}`);

  while (!isStopping()) {
    try {
      if (!(await isEnabled("telegram_enabled"))) {
        await stoppableSleep(60_000);
        continue;
      }

      const updates = await getUpdates(offset);
      conflicts = 0;
      errors = 0;

      // Dispatch WITHOUT awaiting. `enqueueKeyed` inside processUpdate still
      // serialises per chat — which is what conversational memory needs — while
      // different chats finally run concurrently, as keyed-queue.ts always
      // claimed. Awaiting here meant one 20s turn froze every other chat AND
      // the approval buttons, which take this same path.
      for (const update of updates) {
        void trackDrain(
          processUpdate(update).catch((e: unknown) => {
            // One poisonous update must not wedge anything behind it.
            console.error("[telegram] update failed:", e instanceof Error ? e.message : e);
          }),
        );
        offset = update.update_id + 1;

        // Each turn holds a provider socket and spends money; an unbounded
        // burst would be an unbounded bill. Wait for room before accepting more.
        while (inFlight() >= MAX_CONCURRENT_TURNS && !isStopping()) {
          await stoppableSleep(250);
        }
      }

      // Once per batch rather than per update. Awaited, so a stale offset can
      // never overwrite a newer one; long polls return a single update in
      // normal operation, so the crash exposure is unchanged in practice.
      if (updates.length > 0) await setPolicyValue(OFFSET_KEY, offset).catch(() => {});

      const now = Date.now();
      if (now - lastHeartbeat >= 60_000) {
        lastHeartbeat = now;
        await setPolicyValue("heartbeat:telegram-poller", new Date().toISOString()).catch(() => {});
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      if (/conflict/i.test(message)) {
        conflicts += 1;
        // Two pollers overlap briefly on every redeploy; only a persistent
        // conflict (~1 minute) means a second instance is genuinely stuck up.
        if (conflicts >= CONFLICT_ALERT_AFTER) {
          await alertOwner("Telegram poller conflict persists — is a second worker running?", {
            key: "telegram_conflict",
            throttleMs: 30 * 60_000,
          }).catch(() => {});
          conflicts = 0;
        }
        await stoppableSleep(3_000);
        continue;
      }

      errors += 1;
      console.error(`[telegram] poll failed (${errors}):`, message);
      if (errors === 3) {
        await alertOwner(`Telegram poller failing: ${message}`, { key: "telegram_poll" }).catch(
          () => {},
        );
      }
      await stoppableSleep(Math.min(3_000 * 2 ** (errors - 1), 5 * 60_000));
    }
  }

  console.warn("[telegram] poller stopped");
}
