import { setPolicyValue } from "../lib/policy-kv.js";
import { isStopping, stoppableSleep, trackDrain } from "../lib/shutdown.js";
import { alertOwner } from "../lib/owner.js";

/**
 * The one loop shape every background worker uses: iterate → heartbeat → sleep,
 * with exponential backoff on consecutive failures and an owner alert once the
 * failures stop looking like a blip.
 *
 * The heartbeat is what makes a stalled loop visible: a health check can read
 * `heartbeat:<name>` from `hermes_policy` and see that a loop stopped advancing
 * even though the process is still up and passing its HTTP healthcheck.
 */

const BACKOFF_CAP_MS = 15 * 60_000;
const HEARTBEAT_MIN_INTERVAL_MS = 60_000;
const ALERT_AFTER_FAILURES = 3;

export async function runLoop(
  name: string,
  intervalMs: number,
  iterate: () => Promise<void>,
): Promise<void> {
  let failures = 0;
  let lastHeartbeat = 0;

  while (!isStopping()) {
    try {
      await trackDrain(iterate());
      failures = 0;

      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_MIN_INTERVAL_MS) {
        lastHeartbeat = now;
        // A heartbeat write must never be able to kill the loop it measures.
        await setPolicyValue(`heartbeat:${name}`, new Date().toISOString()).catch(() => {});
      }
    } catch (e) {
      failures += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[loop:${name}] iteration failed (${failures}):`, message);

      // Alert once, exactly at the threshold — not on every subsequent failure.
      if (failures === ALERT_AFTER_FAILURES) {
        await alertOwner(`Hermes loop "${name}" has failed ${failures}x: ${message}`, {
          key: `loop:${name}`,
        }).catch(() => {});
      }
    }

    const delay =
      failures > 0 ? Math.min(intervalMs * 2 ** failures, BACKOFF_CAP_MS) : intervalMs;
    await stoppableSleep(delay);
  }

  console.warn(`[loop:${name}] stopped`);
}
