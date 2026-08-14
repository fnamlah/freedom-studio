/**
 * When a stalled provider round may be recovered from.
 *
 * A pure module for the same reason `history.ts` is one: `converse.ts` reaches
 * the database through `tools.js`, so a decision worth testing has to live
 * where a test can import it without booting an environment.
 *
 * The rule this encodes came out of a real incident. A turn spent 4.4s on its
 * first provider call, ran one tool in 1.4s, then stalled on the second call
 * until the 25s per-request ceiling killed it — at 30.8s of a 60s budget, with
 * a perfectly good tool result already in hand. It answered "something went
 * wrong" and threw the work away. `provider.ts` had reserved that headroom
 * explicitly ("still leaves room for the turn to recover and answer") and
 * nothing ever used it.
 */

export interface StallContext {
  /** Node names a per-request `AbortSignal.timeout()` failure `TimeoutError`. */
  errorName: string | undefined;
  /** Whether the whole-turn deadline has fired. Nothing survives that. */
  turnAborted: boolean;
  /** Tool calls completed so far. Zero means there is nothing to conclude from. */
  toolRuns: number;
  /** Whether this turn already spent its one recovery. */
  alreadyRecovered: boolean;
  /** Milliseconds left before the turn deadline. */
  budgetLeftMs: number;
  /** The per-request ceiling; a recovery needs at least this much room. */
  minBudgetMs: number;
}

/**
 * Four conditions, each of which has to hold, and each for its own reason:
 *
 *   1. It must be a per-request TIMEOUT. A 401, a 400 from a rejected
 *      temperature, or a malformed response are not transient — retrying them
 *      just spends money to fail identically.
 *   2. The TURN deadline must not have fired. That ceiling is the outer bound
 *      and is not negotiable from in here.
 *   3. There must be tool results to conclude from. Recovering a round-1 stall
 *      would ask the model to answer with nothing in hand, and the one thing
 *      this bot must never do is invent a figure.
 *   4. There must be room to finish. Starting a 25s-capped call with less than
 *      that left trades a provider timeout for a turn-deadline abort — a
 *      different error and the same silence.
 *
 * ONCE only, tracked by the caller. A provider stalling twice in one turn is
 * not having a bad moment; it is down, and the honest answer is to say so.
 */
export function canRecoverFromStall(ctx: StallContext): boolean {
  return (
    ctx.errorName === "TimeoutError" &&
    !ctx.turnAborted &&
    ctx.toolRuns > 0 &&
    !ctx.alreadyRecovered &&
    ctx.budgetLeftMs > ctx.minBudgetMs
  );
}
