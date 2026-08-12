"use server";

import { revalidatePath } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Snapshot the live forecast into `forecast_snapshots` (docs/09 §8.2, docs/04 §4.12).
 *
 * Live projections (`v_earnings_forecast` / `fn_forecast`) are recomputed on every
 * read and never stored — there is no staleable copy of derived money data. The
 * ONLY reason `forecast_snapshots` exists is accuracy tracking: you cannot measure
 * forecast error without remembering what was predicted *at the time*, so
 * `fn_snapshot_forecast()` records today's projection to be scored later by
 * `v_forecast_accuracy` (docs/09 §8.2).
 *
 * The RPC is restricted to super_admin + finance (docs/04 §7.3 "RPC surface"), and
 * the table's one-snapshot-per-scope-per-day unique index (docs/04 §4.12) bounds a
 * repeated click for the day. We re-guard with `requireRole` and audit every call
 * with the dotted-verb `forecast.snapshot` (docs/04 §4.16).
 */

export type SnapshotResult =
  | { ok: true; count: number; message: string }
  | { ok: false; error: string };

export async function snapshotForecast(): Promise<SnapshotResult> {
  const { supabase, profile } = await requireRole("super_admin", "finance");
  // The guard already loaded the profile, so the caller's language is free.
  const d = dict(toLocale(profile.locale));

  try {
    const { data, error } = await supabase.rpc("fn_snapshot_forecast", {});

    if (error) {
      // 23505 = the per-scope-per-day unique index already holds today's snapshot.
      if (error.code === "23505") {
        return { ok: false, error: d.money.forecasts.errAlreadySnapshotted };
      }
      if (error.code === "42501") {
        return { ok: false, error: d.money.forecasts.errNotAuthorized };
      }
      return { ok: false, error: d.money.forecasts.errSnapshotFailed };
    }

    const count = typeof data === "number" ? data : 0;

    await writeAudit({
      action: "forecast.snapshot",
      entityType: "forecast_snapshot",
      metadata: { rows: count },
    });

    revalidatePath("/forecasts");

    return {
      ok: true,
      count,
      // Russian inflects the noun by count (1 строка / 2 строки / 5 строк), so
      // the whole sentence is one dictionary function, not a stitched-on "s".
      message:
        count > 0 ? d.money.forecasts.okSnapshotted(count) : d.money.forecasts.okSnapshotEmpty,
    };
  } catch (err) {
    if (isAuthzError(err)) {
      return { ok: false, error: d.money.forecasts.errNotAuthorized };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
