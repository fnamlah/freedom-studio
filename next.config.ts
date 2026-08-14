import type { NextConfig } from "next";

// Security headers per docs/08-security-threat-model.md §4.1.
// CSP is applied per-request with a nonce in middleware.ts; the static headers
// below are the ones that do not need per-request values.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// The only anonymous surface is the share-view Edge Function (docs/06 §5.3).
// Route /share/:token to it so shareable document links resolve without ever
// exposing a Supabase URL to the recipient. The Supabase project URL is public.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Resolve TypeScript's `.js` import convention.
 *
 * `src/lib/fields/*` and `src/lib/forms.ts` are imported by BOTH this app and
 * the Hermes worker. The worker emits Node ESM, where a relative specifier
 * MUST carry a runtime extension — so those modules import `../forms.js`,
 * which TypeScript resolves to `forms.ts` and Node later resolves to the
 * emitted `forms.js`. Next's bundler does not apply that mapping by default
 * and fails with "Can't resolve '../forms.js'".
 *
 * Teaching both bundlers the mapping is the fix that keeps ONE copy of the
 * validation rules. The alternative — dropping the extension — would compile
 * here and crash the worker at runtime, which is the failure this whole shared
 * module exists to avoid.
 */
const extensionAlias = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"] },
  webpack: (config) => {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ...extensionAlias };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    if (!supabaseUrl) return [];
    return [
      {
        source: "/share/:token",
        destination: `${supabaseUrl}/functions/v1/share-view/:token`,
      },
    ];
  },
};

export default nextConfig;
