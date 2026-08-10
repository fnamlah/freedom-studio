// =============================================================================
// share-view — Freedom Studio Edge Function (Deno)
// -----------------------------------------------------------------------------
// The ONLY anonymous surface in the system (docs/06-documents-sharing.md §5.3,
// docs/02-architecture.md trust zones). It resolves a share token to a document
// and serves an HTML viewer page that embeds a 60-second signed URL.
//
// Deployed with `verify_jwt = false` (supabase/config.toml): external viewers
// hold no session. The function itself runs with the service-role key, which is
// exactly why the `anon` database role needs ZERO grants — 008_rls_policies.sql
// revokes everything from anon, and nothing here depends on that changing.
//
// Design invariants this file implements verbatim:
//
//   1. The raw token is never stored and never logged. Only SHA-256(token),
//      optionally peppered, is ever compared — against a unique index, so the
//      comparison is an index probe and not a secret-dependent string compare.
//   2. UNIFORM 404. Unknown, expired, revoked, exhausted, rate-limited, wrong
//      method, missing token, storage failure — every failure returns the SAME
//      status, body and headers. The endpoint is not a state oracle (§5.4).
//   3. Validation and increment happen inside ONE conditional UPDATE statement,
//      so two requests racing for the last permitted view cannot both win.
//   4. HTML viewer page, never a redirect: a 302 would put the signed URL in the
//      address bar, history and intermediary logs, creating a second shareable
//      artifact (§5.3).
//   5. IPs are stored only as salted hashes, never raw (§5.6).
// =============================================================================

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.58.0";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/** Signed-URL TTL, seconds. The residual-exposure bound after a revoke (§5.5). */
const SIGNED_URL_TTL_SECONDS = 60;

/** Fixed rate-limit window, milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Requests allowed per IP per window. */
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Bounded retries for the compare-and-swap statements under contention. */
const CAS_MAX_ATTEMPTS = 4;

/** Probability of an opportunistic sweep of stale rate-limit windows. */
const RATE_LIMIT_SWEEP_CHANCE = 0.02;

/** Longest user-agent string persisted with a view row. */
const USER_AGENT_MAX_LENGTH = 512;

/** Path segments that are transport plumbing, never a token. */
const RESERVED_PATH_SEGMENTS = new Set([
  "share",
  "share-view",
  "functions",
  "v1",
  "",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Optional pepper mixed into token hashing (docs/10 §4.2). It must match the
 * value the share-creating server action used, and rotating it invalidates every
 * outstanding link — the intentional hard-stop lever of §5.5.
 */
const SHARE_TOKEN_PEPPER = Deno.env.get("SHARE_TOKEN_PEPPER") ?? "";

/**
 * Salt for IP hashing. Falls back to the token pepper so a deployment that sets
 * only one secret still never writes a raw IP; the last-resort constant keeps a
 * misconfigured deployment from degrading to plaintext.
 */
const IP_HASH_SALT = Deno.env.get("SHARE_IP_SALT") ||
  SHARE_TOKEN_PEPPER ||
  "freedom-studio-share-ip";

/** Bucket holding compliance documents (docs/06 §2.1). */
const DOCUMENTS_BUCKET = "model-documents";

// -----------------------------------------------------------------------------
// The uniform 404
// -----------------------------------------------------------------------------

const UNIFORM_404_BODY = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Not found</title>
<style>
  html { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0d10; color: #e6e8eb;
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 .5rem; }
  p { margin: 0; color: #9aa4b2; }
</style>
</head>
<body>
<main>
<h1>Not found</h1>
<p>This link is not available.</p>
</main>
</body>
</html>
`;

/**
 * The single failure response. Every rejection path returns exactly this — same
 * status, same bytes, same headers — so an attacker probing tokens learns
 * nothing about whether a guess was close, whether a link was revoked, or how
 * many views remain (§5.4).
 */
function uniform404(): Response {
  return new Response(UNIFORM_404_BODY, {
    status: 404,
    headers: baseSecurityHeaders({ "Content-Type": "text/html; charset=utf-8" }),
  });
}

/**
 * Headers applied to every response this function emits.
 *
 * `Referrer-Policy: no-referrer` matters more here than anywhere else in the
 * system: without it the browser would send the token URL as the Referer when it
 * fetches the embedded object, handing the token to the storage layer's logs.
 */
function baseSecurityHeaders(extra: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    ...extra,
  });
  return headers;
}

// -----------------------------------------------------------------------------
// Hashing helpers (Web Crypto — no dependencies)
// -----------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Token hash: `SHA-256(pepper || token)`, lowercase hex. With no pepper set this
 * is plain `SHA-256(token)` — the form docs/06 §5.1 specifies — so a deployment
 * can adopt or drop the pepper only together with a re-issue of all links.
 */
function hashToken(token: string): Promise<string> {
  return sha256Hex(`${SHARE_TOKEN_PEPPER}${token}`);
}

/** IP hash: salted, one-way. The raw address never leaves this function's stack. */
function hashIp(ip: string): Promise<string> {
  return sha256Hex(`${IP_HASH_SALT}|${ip}`);
}

// -----------------------------------------------------------------------------
// Request parsing
// -----------------------------------------------------------------------------

/**
 * Accepts both shapes the deployment may present:
 *   • path segment — /share/{token}, /share-view/{token}, /functions/v1/share-view/{token}
 *   • query string — ?t={token}
 *
 * The last non-reserved path segment wins. Tokens are base64url (~43 chars for
 * the 32-byte CSPRNG token of §5.1); anything outside that alphabet is rejected
 * before it can reach a database round-trip.
 */
function extractToken(url: URL): string | null {
  const queryToken = url.searchParams.get("t") ?? url.searchParams.get("token");
  if (queryToken && isPlausibleToken(queryToken)) return queryToken;

  const segments = url.pathname.split("/").map(decodeSegment);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (RESERVED_PATH_SEGMENTS.has(segment)) continue;
    return isPlausibleToken(segment) ? segment : null;
  }
  return null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isPlausibleToken(candidate: string): boolean {
  return candidate.length >= 16 &&
    candidate.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(candidate);
}

/** Client IP, best effort. Absent headers hash to a shared bucket, which is fine. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown";
}

// -----------------------------------------------------------------------------
// Rate limiting — Postgres-backed fixed window (docs/06 §5.6)
// -----------------------------------------------------------------------------

/**
 * Fixed one-minute window keyed by (ip_hash, window_start), the shape
 * `share_rate_limits` was created with in 002_tables_core.sql. The table has no
 * permissive policy for any role: only this function, holding the service role,
 * touches it.
 *
 * A fixed window, not a refilling bucket: one row per IP per minute, no refill
 * arithmetic and nothing to keep warm between invocations. Given the 256-bit
 * tokens of §5.1 this limit is anti-nuisance and anti-log-flood, not a guessing
 * safeguard — brute force is already hopeless — so the crudest correct counter
 * is the right one.
 *
 * PostgREST cannot express `request_count = request_count + 1`, so the increment
 * is a compare-and-swap: read the count, then write `count + 1` guarded by
 * `request_count = <observed>`. A concurrent request that beat us fails the
 * guard and we retry against the new value, so no two callers can consume the
 * same slot.
 *
 * Fails CLOSED. A database error here yields the uniform 404 rather than an
 * unmetered anonymous surface — security over availability, per the package
 * stance in docs/00 §1.
 *
 * @returns true when the request is within budget.
 */
async function withinRateLimit(
  db: SupabaseClient,
  ipHash: string,
): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS,
  ).toISOString();

  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const { data: existing, error: readError } = await db
      .from("share_rate_limits")
      .select("request_count")
      .eq("ip_hash", ipHash)
      .eq("window_start", windowStart)
      .maybeSingle();

    if (readError) return false;

    if (!existing) {
      const { error: insertError } = await db
        .from("share_rate_limits")
        .insert({ ip_hash: ipHash, window_start: windowStart, request_count: 1 });

      if (!insertError) return true;
      // Unique-violation: another request created the window first. Retry and
      // take the compare-and-swap path against the row it wrote.
      if (insertError.code === "23505") continue;
      return false;
    }

    const observed = existing.request_count ?? 0;
    if (observed >= RATE_LIMIT_MAX_REQUESTS) return false;

    const { data: updated, error: updateError } = await db
      .from("share_rate_limits")
      .update({ request_count: observed + 1 })
      .eq("ip_hash", ipHash)
      .eq("window_start", windowStart)
      .eq("request_count", observed)
      .select("request_count")
      .maybeSingle();

    if (updateError) return false;
    if (updated) return true;
    // Lost the race; loop and re-read.
  }

  // Contention this heavy is itself abuse-shaped. Fail closed.
  return false;
}

/**
 * Opportunistic housekeeping: on a small fraction of requests, drop windows that
 * can no longer be current. Keeps the table bounded without a scheduler.
 */
async function sweepRateLimitWindows(db: SupabaseClient): Promise<void> {
  if (Math.random() > RATE_LIMIT_SWEEP_CHANCE) return;
  const cutoff = new Date(Date.now() - 10 * RATE_LIMIT_WINDOW_MS).toISOString();
  await db.from("share_rate_limits").delete().lt("window_start", cutoff);
}

// -----------------------------------------------------------------------------
// The counted, validating consume step (docs/06 §5.3)
// -----------------------------------------------------------------------------

type ConsumedShare = { id: string; document_id: string };

/**
 * Consumes one view of the share identified by `tokenHash`, or returns null.
 *
 * The load-bearing property from §5.3 is that validation and increment happen in
 * ONE statement whose WHERE clause re-checks revocation, expiry and the view
 * limit at increment time — a "validate, then increment" pair would let two
 * requests both take the last permitted view.
 *
 * PostgREST has no column-referencing update expressions, so the canonical
 * statement
 *
 *   UPDATE document_shares
 *      SET view_count = view_count + 1, last_viewed_at = now()
 *    WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
 *      AND (max_views IS NULL OR view_count < max_views)
 *   RETURNING id, document_id
 *
 * is issued as its compare-and-swap equivalent: the same guard predicates plus
 * `view_count = <observed>`, writing `<observed> + 1`. Each attempt is still a
 * single atomic UPDATE ... RETURNING, and the extra equality is what makes the
 * race impossible: the loser of a tie matches zero rows and, on re-read, either
 * sees the limit reached (404) or takes the next free slot.
 *
 * `max_views` is re-evaluated on every attempt from freshly read row state, so a
 * revoke or an expiry landing mid-retry is honoured.
 */
async function consumeShare(
  db: SupabaseClient,
  tokenHash: string,
): Promise<ConsumedShare | null> {
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const { data: share, error: readError } = await db
      .from("document_shares")
      .select("id, document_id, view_count, max_views, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (readError || !share) return null;

    // Pre-checks are UX for the retry loop only; the authoritative re-check is
    // the WHERE clause of the UPDATE below.
    if (share.revoked_at !== null) return null;
    if (new Date(share.expires_at).getTime() <= Date.now()) return null;

    const observed: number = share.view_count ?? 0;
    const maxViews: number | null = share.max_views ?? null;
    if (maxViews !== null && observed >= maxViews) return null;

    const nowIso = new Date().toISOString();
    let statement = db
      .from("document_shares")
      .update({ view_count: observed + 1, last_viewed_at: nowIso })
      .eq("token_hash", tokenHash)
      .eq("view_count", observed)
      .is("revoked_at", null)
      .gt("expires_at", nowIso);

    if (maxViews !== null) {
      // Mirrors `view_count < max_views` for this row's known limit.
      statement = statement.lt("view_count", maxViews);
    }

    const { data: consumed, error: updateError } = await statement
      .select("id, document_id")
      .maybeSingle();

    if (updateError) return null;
    if (consumed) return consumed as ConsumedShare;
    // Zero rows: someone else moved the counter (or the row just became
    // invalid). Re-read and decide again.
  }

  return null;
}

// -----------------------------------------------------------------------------
// The viewer page
// -----------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the document inline.
 *
 * Images get an <img>; everything else (PDFs, text) gets an <iframe>. Both keep
 * the signed URL inside the page: it is never a navigable address, so it cannot
 * be copied out of the address bar or land in history (§5.3).
 *
 * The page carries no script at all and says so in its own CSP
 * (`script-src 'none'`), which makes the viewer inert even if a filename or
 * label ever carried markup — belt and braces on top of escaping.
 */
function viewerPage(
  signedUrl: string,
  fileName: string,
  mimeType: string,
  storageOrigin: string,
): Response {
  const isImage = mimeType.startsWith("image/");
  const safeUrl = escapeHtml(signedUrl);
  const safeName = escapeHtml(fileName);

  const body = isImage
    ? `<img src="${safeUrl}" alt="${safeName}">`
    : `<iframe src="${safeUrl}" title="${safeName}" referrerpolicy="no-referrer"></iframe>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${safeName}</title>
<style>
  html { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    background: #0b0d10; color: #e6e8eb;
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: baseline;
    justify-content: space-between;
    padding: .875rem 1.25rem; border-bottom: 1px solid #232830; background: #111419;
  }
  header strong { font-weight: 600; font-size: .95rem; }
  header span { color: #9aa4b2; font-size: .8125rem; }
  main { flex: 1; display: flex; padding: 1rem; min-height: 0; }
  img, iframe {
    flex: 1; width: 100%; border: 1px solid #232830; border-radius: 8px;
    background: #111419;
  }
  img { object-fit: contain; }
  iframe { min-height: 70vh; }
  footer { padding: .75rem 1.25rem; color: #6b7482; font-size: .75rem; }
</style>
</head>
<body>
<header>
  <strong>${safeName}</strong>
  <span>Shared document &middot; access expires shortly</span>
</header>
<main>${body}</main>
<footer>This view has been recorded. Reload the original link to view again, if the link still permits it.</footer>
</body>
</html>
`;

  // The only external origin the page may talk to is the storage host that
  // issued the signed URL.
  const csp = [
    "default-src 'none'",
    `img-src ${storageOrigin} data:`,
    `frame-src ${storageOrigin}`,
    "style-src 'unsafe-inline'",
    "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  return new Response(html, {
    status: 200,
    headers: baseSecurityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    }),
  });
}

/**
 * `documents.storage_path` is recorded with the bucket prefix (docs/06 §2.1),
 * while `createSignedUrl` wants the key relative to the bucket. Tolerate both
 * so a row written either way still resolves.
 */
function objectKey(storagePath: string): string {
  const trimmed = storagePath.replace(/^\/+/, "");
  return trimmed.startsWith(`${DOCUMENTS_BUCKET}/`)
    ? trimmed.slice(DOCUMENTS_BUCKET.length + 1)
    : trimmed;
}

/** Origin of a URL, or null when it cannot be parsed. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  // A misconfigured deployment must not become a permissive one.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[share-view] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return uniform404();
  }

  // Only document reads. Anything else is indistinguishable from a bad token.
  if (request.method !== "GET" && request.method !== "HEAD") return uniform404();

  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return uniform404();

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await hashIp(clientIp(request));

  // Rate limit BEFORE the token lookup: an abusive client must not be able to
  // make us do database work per request (§5.6).
  if (!(await withinRateLimit(db, ipHash))) return uniform404();

  const tokenHash = await hashToken(token);
  const share = await consumeShare(db, tokenHash);
  if (!share) return uniform404();

  // From here the view is already counted. Record it before minting the URL so
  // that a storage failure still leaves the audit trail behind.
  const userAgent = (request.headers.get("user-agent") ?? "")
    .slice(0, USER_AGENT_MAX_LENGTH) || null;

  const { error: viewError } = await db.from("document_share_views").insert({
    share_id: share.id,
    ip_hash: ipHash,
    user_agent: userAgent,
  });
  if (viewError) console.error("[share-view] view row insert failed", viewError.message);

  // actor_id is NULL: this is an anonymous action, and audit_log allows exactly
  // that (docs/04 §4.16). The token itself is never written to the trail.
  const { error: auditError } = await db.from("audit_log").insert({
    actor_id: null,
    actor_role: null,
    action: "share.view",
    entity_type: "document_shares",
    entity_id: share.id,
    metadata: { document_id: share.document_id, anonymous: true },
    ip: null,
    user_agent: userAgent,
  });
  if (auditError) console.error("[share-view] audit insert failed", auditError.message);

  const { data: document, error: documentError } = await db
    .from("documents")
    .select("storage_path, file_name, mime_type")
    .eq("id", share.document_id)
    .maybeSingle();

  if (documentError || !document) return uniform404();

  const { data: signed, error: signError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(objectKey(document.storage_path), SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error("[share-view] signing failed", signError?.message ?? "no url");
    return uniform404();
  }

  await sweepRateLimitWindows(db);

  const storageOrigin = originOf(signed.signedUrl) ?? originOf(SUPABASE_URL) ?? "'none'";

  return viewerPage(
    signed.signedUrl,
    document.file_name ?? "Document",
    document.mime_type ?? "application/octet-stream",
    storageOrigin,
  );
});
