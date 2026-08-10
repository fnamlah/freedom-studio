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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
