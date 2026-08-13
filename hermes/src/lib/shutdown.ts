/**
 * Graceful shutdown. Railway sends SIGTERM on every redeploy, and a worker that
 * is mid-transaction when it dies leaves half-executed approvals behind — so
 * loops cooperate: they stop starting new work and in-flight work is awaited up
 * to a deadline.
 */

let stopping = false;
const wakers = new Set<() => void>();
const drains = new Set<Promise<unknown>>();

export function isStopping(): boolean {
  return stopping;
}

/** Sleep that returns early when shutdown begins, so SIGTERM isn't held hostage. */
export function stoppableSleep(ms: number): Promise<void> {
  if (stopping) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakers.delete(wake);
      resolve();
    }, ms);
    const wake = () => {
      clearTimeout(timer);
      wakers.delete(wake);
      resolve();
    };
    wakers.add(wake);
  });
}

/** Register in-flight work so shutdown can await it. */
export function trackDrain<T>(p: Promise<T>): Promise<T> {
  drains.add(p);
  void p.finally(() => drains.delete(p));
  return p;
}

/** How much work is in flight — the poller's back-pressure signal. */
export function inFlight(): number {
  return drains.size;
}

export function installSignalHandlers(opts: { deadlineMs?: number } = {}): void {
  // Longer than one turn's own 60s ceiling (llm/converse.ts). At 25s a
  // redeploy killed conversations mid-sentence; now the drain outlasts the
  // slowest thing it is draining.
  const deadlineMs = opts.deadlineMs ?? 70_000;
  let signalled = false;

  const onSignal = (signal: string) => {
    // A second signal means the platform is impatient — let it kill us.
    if (signalled) return;
    signalled = true;
    stopping = true;
    console.warn(`[shutdown] ${signal} received; draining ${drains.size} task(s)`);
    for (const wake of [...wakers]) wake();

    const deadline = new Promise((r) => setTimeout(r, deadlineMs));
    void Promise.race([Promise.allSettled([...drains]), deadline]).then(() => {
      console.warn("[shutdown] drained; exiting");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}
