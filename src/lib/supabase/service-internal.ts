import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { requireEnv, SUPABASE_URL } from "@/lib/env";

/**
 * ############################################################################
 * # INTERNAL MODULE — DO NOT IMPORT FROM FEATURE CODE.                       #
 * #                                                                          #
 * # This constructs a service-role client, which BYPASSES RLS entirely.      #
 * # Per docs/05-auth-2fa.md §7 (boxed invariant) no code path may build one  #
 * # before the caller's role AND AAL2 assurance have been verified in the    #
 * # same server invocation.                                                  #
 * #                                                                          #
 * # Feature agents must use `guardedAdminClient()` from                      #
 * # `@/lib/supabase/admin` instead. The only three modules permitted to      #
 * # import this file are:                                                    #
 * #   - @/lib/supabase/admin  (applies the role + AAL2 guard)                #
 * #   - @/lib/audit           (audit_log is service-role-write by design)    #
 * #   - @/lib/settings        (non-secret global config, caller-independent)  #
 * ############################################################################
 */

export type ServiceRoleClient = SupabaseClient<Database, "public">;

/** Hard stop if this module is ever pulled into a client bundle. */
function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY: the Supabase service-role client was constructed in a browser context.",
    );
  }
}

/**
 * Builds a fresh service-role client.
 *
 * No session persistence, no auto-refresh, no realtime auth — this client is
 * stateless and must never be handed a user JWT.
 */
export function createServiceRoleClient(): ServiceRoleClient {
  assertServerOnly();

  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = SUPABASE_URL || requireEnv("NEXT_PUBLIC_SUPABASE_URL");

  return createClient<Database, "public">(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "freedom-studio-server" },
    },
  });
}

/** True when the service-role key is configured in this environment. */
export function hasServiceRoleKey(): boolean {
  return typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0;
}
