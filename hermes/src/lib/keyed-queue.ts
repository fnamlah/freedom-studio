/**
 * Per-key FIFO. Two updates from the same chat must not interleave — both would
 * load the same conversation history and the slower one would clobber the
 * faster one's turn. Different chats stay fully concurrent.
 */
const tails = new Map<string, Promise<unknown>>();

export function enqueueKeyed<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // `fn` is passed as BOTH handlers so a rejected predecessor still lets the
  // next item run — one bad turn must not wedge the chat forever.
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    // Only clear if we are still the newest entry, or we'd drop a live chain.
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
