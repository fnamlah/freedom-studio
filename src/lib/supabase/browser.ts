"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Browser Supabase client — trust zone 1 (docs/02-architecture.md §3).
 *
 * BOXED INVARIANT (docs/05-auth-2fa.md §7): the browser holds the anon key and
 * the user's JWT, and nothing else. The service-role key must never appear in
 * any client component, `NEXT_PUBLIC_*` variable, or serialized page payload.
 * Everything this client can read is bounded by RLS + the AAL2 restrictive policy.
 */
export type BrowserSupabaseClient = SupabaseClient<Database, "public">;

let client: BrowserSupabaseClient | undefined;

/**
 * Returns the singleton browser client. Safe to call from any client component;
 * repeated calls reuse the same instance so auth state stays consistent.
 *
 * ```ts
 * "use client";
 * const supabase = createBrowserSupabase();
 * await supabase.auth.signOut();
 * ```
 */
export function createBrowserSupabase(): BrowserSupabaseClient {
  if (!client) {
    client = createBrowserClient<Database, "public">(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
