import { headers } from "next/headers";

/**
 * Reads the per-request CSP nonce minted by `src/middleware.ts`.
 *
 * The CSP in docs/08-security-threat-model.md §4.1 allows scripts only with
 * `'nonce-…' 'strict-dynamic'`, so ANY inline `<script>` a server component
 * renders must carry this nonce or the browser will refuse to execute it.
 *
 * ```tsx
 * const nonce = await getNonce();
 * return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: bootstrap }} />;
 * ```
 *
 * Returns `undefined` outside a request scope (or if the middleware did not run,
 * which itself means the request never reached an app route).
 */
export async function getNonce(): Promise<string | undefined> {
  try {
    const headerList = await headers();
    return headerList.get("x-nonce") ?? undefined;
  } catch {
    return undefined;
  }
}
