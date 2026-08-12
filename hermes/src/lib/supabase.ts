import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@studio/lib/database.types.js";
import { env } from "../config/env.js";

/**
 * The worker's service-role client.
 *
 * SERVER-ONLY, and bypassing RLS is NOT bypassing governance: the
 * `hermes_approvals` guard trigger, the append-only triggers on `audit_log` and
 * `ledger_entries` (migration 013), and every CHECK constraint still bind this
 * client. What the service role buys us is the ability to run without a user
 * session at all — which is the whole reason an unattended agent needs it.
 *
 * Every query must scope itself explicitly. There is no RLS safety net here.
 */
let cached: SupabaseClient<Database> | null = null;

export function getAdminClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-hermes-service": "true" } },
    });
  }
  return cached;
}
