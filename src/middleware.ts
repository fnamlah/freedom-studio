import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_ROUTES,
  isAnonymousAllowed,
  isAuthPath,
  loginWithNext,
} from "@/lib/auth/routes";

/**
 * Edge middleware — AAL2 enforcement LAYER 1 (docs/05-auth-2fa.md §5) plus the
 * per-request Content-Security-Policy nonce (docs/08-security-threat-model.md §4.1).
 *
 * This layer exists for USABILITY, not security. It produces friendly redirects
 * for under-assured sessions. The authoritative control is the per-table
 * RESTRICTIVE RLS policy in the database: a caller that bypasses this file
 * entirely — a stolen AAL1 bearer token hitting PostgREST directly — still reads
 * zero rows. Never move an authorization decision here from the database.
 *
 * Responsibilities, in order:
 *   1. mint a CSP nonce and expose it as the `x-nonce` request header;
 *   2. refresh the Supabase session (writing the rotated cookies onto the response);
 *   3. route by assurance level;
 *   4. stamp CSP + cross-origin isolation headers on whatever response is returned.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function middleware(request: NextRequest) {
  const nonce = createNonce();
  const pathname = request.nextUrl.pathname;

  const buildHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: buildHeaders() } });

  /** Carries the refreshed session cookies onto a redirect response. */
  const redirectTo = (path: string) => {
    const target = NextResponse.redirect(new URL(path, request.url));
    for (const cookie of response.cookies.getAll()) {
      target.cookies.set(cookie);
    }
    return applySecurityHeaders(target, nonce);
  };

  // Without Supabase configured there is no session to evaluate; still ship the
  // security headers so a misconfigured deploy is not also an unprotected one.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return applySecurityHeaders(response, nonce);
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: buildHeaders() } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: getUser() (not getSession()) — it validates the token against the
  // Auth server and performs the refresh whose cookies we forward above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Route handlers enforce their own guards and must return JSON, not a 3xx:
  // redirecting an XHR would surface as an opaque parse error in the client.
  if (pathname.startsWith("/api/")) {
    return applySecurityHeaders(response, nonce);
  }

  if (!user) {
    if (isAnonymousAllowed(pathname)) {
      return applySecurityHeaders(response, nonce);
    }
    return redirectTo(loginWithNext(pathname, request.nextUrl.search));
  }

  // Assurance is read from Supabase Auth rather than guessed:
  //   nextLevel 'aal2' + currentLevel != 'aal2' -> a verified factor exists, challenge it
  //   nextLevel != 'aal2'                        -> no verified factor, force enrollment
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const isAal2 = assurance?.currentLevel === "aal2";

  if (!isAal2) {
    if (isAuthPath(pathname)) {
      return applySecurityHeaders(response, nonce);
    }
    return redirectTo(
      assurance?.nextLevel === "aal2" ? AUTH_ROUTES.mfaChallenge : AUTH_ROUTES.mfaEnroll,
    );
  }

  // Fully assured: showing the sign-in form again would be confusing.
  if (pathname === AUTH_ROUTES.login) {
    return redirectTo("/dashboard");
  }

  return applySecurityHeaders(response, nonce);
}

/* --------------------------------------------------------------- helpers */

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * CSP per docs/08 §4.1. `script-src` runs only with the per-request nonce plus
 * `strict-dynamic`; `connect-src` is pinned to the single Supabase project
 * origin; `style-src 'unsafe-inline'` is the recorded concession to Next.js
 * inline style tags and permits no script execution.
 */
function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  const connectSrc = ["'self'"];

  if (SUPABASE_URL) {
    try {
      const origin = new URL(SUPABASE_URL).origin;
      connectSrc.push(origin, origin.replace(/^https:/, "wss:"));
    } catch {
      // Unparseable URL: leave connect-src at 'self' rather than widening it.
    }
  }

  if (isDev) {
    // Next.js dev tooling (HMR, React refresh) needs eval + a websocket.
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws:", "wss:");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (!isDev) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/**
 * Headers that need a per-request value or are not already set globally in
 * `next.config.ts`. HSTS / nosniff / frame-options / referrer-policy /
 * permissions-policy come from the Next config; these complete docs/08 §4.1.
 */
function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));
  response.headers.set("x-nonce", nonce);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except:
     *  - _next/static, _next/image  (immutable build output)
     *  - favicon / robots / sitemap / manifest
     *  - static asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
