/**
 * The worker's view of THE redaction chokepoint.
 *
 * RELATIVE import, deliberately — the same technique `lib/i18n.ts` documents:
 * `tsc` does not rewrite `@studio/*` path aliases at emit, so an aliased value
 * import compiles and then fails inside the container. Because `rootDir` is the
 * repo root, this path resolves identically in `src/` and in `dist/`.
 *
 * Re-exported rather than re-implemented, and `governance.test.ts` asserts
 * exactly that: the worker must use the app's real redactor, never a copy. A
 * vendored copy would drift, and the copy that drifts is the one that leaks.
 *
 * `redactor.ts` has zero imports of its own, so nothing else is dragged in.
 */
export {
  PROJECTIONS,
  RedactionError,
  redactToolResult,
  scrubText,
} from "../../../src/lib/ai/redactor.js";
