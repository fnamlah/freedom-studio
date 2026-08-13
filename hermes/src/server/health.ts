import { createServer, type Server } from "node:http";

import { env } from "../config/env.js";
import { getPolicyValue } from "../lib/policy-kv.js";

/**
 * Minimal health surface. Railway needs an HTTP endpoint to call a deploy
 * successful, and the worker role serves it too — otherwise a single-service
 * deployment can never go green.
 *
 * `/health` is shallow on purpose (is the process up?). `/health/deep` reads
 * the loop heartbeats, because a process can be perfectly alive while every
 * loop inside it is wedged.
 */

const STALE_MS = 15 * 60_000;

/**
 * Only loops that actually started are health-checked.
 *
 * A hardcoded list meant the Telegram poller — correctly skipped when no bot
 * token is configured — was reported stale forever, so `/health/deep` returned
 * 503 permanently and Railway would never mark the deploy live. A disabled
 * feature is not an unhealthy one.
 */
const activeLoops = new Set<string>();

export function registerLoop(name: string): void {
  activeLoops.add(name);
}

export function startHealthServer(): Server {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "freedom-hermes", role: env.ROLE }));
      return;
    }

    if (url === "/health/deep") {
      const now = Date.now();
      const loops: Record<string, { last: string | null; stale: boolean }> = {};
      let anyStale = false;

      for (const name of activeLoops) {
        const last = await getPolicyValue<string>(`heartbeat:${name}`).catch(() => null);
        // A loop that has started but not yet written its first heartbeat is
        // starting, not stale — only elapsed time past STALE_MS counts.
        const stale = last !== null && now - Date.parse(last) > STALE_MS;
        if (stale) anyStale = true;
        loops[name] = { last, stale };
      }

      // Reported, deliberately NOT a 503: a worker with no provider key is
      // degraded in one capability, not unhealthy — its jobs, approvals and
      // slash commands are all exact database reads that need no model. But it
      // must be visible here, because "every loop heartbeats" was true on the
      // day conversation was silently unavailable.
      const conversational = Boolean(env.MOONSHOT_API_KEY || env.ZHIPU_API_KEY);

      res.writeHead(anyStale ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: anyStale ? "degraded" : "ok", loops, conversational }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(env.PORT, () => {
    console.info(`[health] listening on :${env.PORT} (role=${env.ROLE})`);
  });
  return server;
}
