"use server";

import { revalidatePath } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
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
  const { supabase } = await requireRole("super_admin", "finance");

  try {
    const { data, error } = await supabase.rpc("fn_snapshot_forecast", {});

    if (error) {
      // 23505 = the per-scope-per-day unique index already holds today's snapshot.
      if (error.code === "23505") {
        return {
          ok: false,
          error:
            "Today's forecast has already been snapshotted — only one snapshot per scope per day is kept.",
        };
      }
      if (error.code === "42501") {
        return { ok: false, error: "You are not authorized to snapshot the forecast." };
      }
      return { ok: false, error: "Could not snapshot the forecast. Please try again." };
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
      message:
        count > 0
          ? `Snapshotted ${count} forecast ${count === 1 ? "row" : "rows"} for accuracy tracking.`
          : "Snapshot recorded — no new forecast rows to store for this period.",
    };
  } catch (err) {
    if (isAuthzError(err)) {
      return { ok: false, error: "You are not authorized to snapshot the forecast." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
