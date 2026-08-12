import { env } from "./config/env.js";
import { installSignalHandlers } from "./lib/shutdown.js";
import { registerLoop, startHealthServer } from "./server/health.js";

/**
 * Freedom Hermes — the studio's always-on agent.
 *
 * One image, selected by ROLE. Both roles serve `/health` so a single Railway
 * service can pass its healthcheck; the worker additionally runs the loops.
 *
 * Loop modules are imported dynamically so the web role never pulls worker
 * dependencies into memory.
 */
async function main(): Promise<void> {
  installSignalHandlers();
  startHealthServer();

  if (env.ROLE === "web") {
    console.info("[hermes] web role: health only");
    return;
  }

  console.info("[hermes] worker role starting");
  const loops: Array<Promise<void>> = [];

  const { runScheduler } = await import("./scheduler/run.js");
  registerLoop("scheduler");
  loops.push(runScheduler());

  const { runApprovalSweep } = await import("./workers/approval-sweep.js");
  registerLoop("approval-sweep");
  loops.push(runApprovalSweep());

  if (env.TELEGRAM_BOT_TOKEN) {
    const { registerBotCommands } = await import("./telegram/register-commands.js");
    void registerBotCommands(); // fire-and-forget: cosmetic, must not delay boot

    const { runTelegramPoller } = await import("./workers/telegram-poller.js");
    registerLoop("telegram-poller");
    loops.push(runTelegramPoller());
  } else {
    console.warn("[hermes] TELEGRAM_BOT_TOKEN unset — Telegram surface disabled");
  }

  await Promise.all(loops);
}

main().catch((e) => {
  console.error("[hermes] fatal:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
