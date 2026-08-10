import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Server-side, user-context Supabase client.
 *
 * Trust zone 2 (docs/02-architecture.md §3): this client carries the CALLER's
 * JWT and the anon key, so every query it issues is evaluated by RLS exactly as
 * the browser's would be. It is the default client for all server components,
 * route handlers and server actions. Elevated work goes through
 * `guardedAdminClient()` in `@/lib/supabase/admin` — never through this file.
 */
export type ServerSupabaseClient = SupabaseClient<Database, "public">;

/**
 * Creates a request-scoped Supabase client bound to Next 15's async cookie store.
 *
 * Cookie writes are attempted and silently ignored when the calling context
 * forbids them (React Server Components). That is safe because `middleware.ts`
 * refreshes the session on every request and writes the refreshed cookies there.
 *
 * ```ts
 * const supabase = await createServerSupabase();
 * const { data } = await supabase.from("models").select("id, stage_name");
 * ```
 */
export async function createServerSupabase(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient<Database, "public">(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only here.
          // middleware.ts owns session refresh, so this is a no-op by design.
        }
      },
    },
  });
}

/**
 * Route-handler / server-action variant.
 *
 * Identical to `createServerSupabase()` — in the App Router both contexts use the
 * same async `cookies()` store, the difference being only that writes actually
 * succeed here. Kept as a distinct, explicitly-named export so route handlers
 * that DO need to persist a refreshed session (auth callbacks, sign-out) read
 * clearly at the call site.
 */
export async function createRouteSupabase(): Promise<ServerSupabaseClient> {
  return createServerSupabase();
}
