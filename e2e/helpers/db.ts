import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "./env";
import type { E2ERole } from "./naming";
import { accessTokenFromStorageState } from "./state";

/**
 * PostgREST client carrying a specific role's OWN AAL2 JWT — the sharpest
 * oracle for RLS assertions: it bypasses every app-layer nicety and asks the
 * database boundary directly, exactly like a stolen-token attacker would.
 * Read-mostly; the only writes specs perform through it are NEGATIVE probes
 * that must affect 0 rows.
 */
export function dbAs(role: E2ERole): SupabaseClient {
  const token = accessTokenFromStorageState(role);
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}
