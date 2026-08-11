"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { snapshotForecast } from "./actions";

/**
 * "Snapshot now" — Super Admin + Finance only (docs/04 §7.3, docs/09 §8.2).
 *
 * Persists the live projection so its accuracy can be scored later. The server
 * action re-guards the role, so this button is a convenience surface only; the DB
 * is the authority. The one-per-day unique index makes a second click for the day
 * a friendly no-op error rather than a duplicate.
 */
export function SnapshotButton() {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await snapshotForecast();
      if (result.ok) {
        success("Forecast snapshotted", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error("Could not snapshot", result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Snapshot now
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Snapshot the current forecast?"
        description="Records today's live projection to forecast_snapshots so its accuracy can be measured later against realized earnings (docs/09 §8.2)."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              Snapshot now
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The live projection is never stored on its own — it is recomputed on every read. A
          snapshot is the only way to remember what was predicted today, which is what makes the
          accuracy bar possible. Only one snapshot per scope is kept per day.
        </p>
      </Dialog>
    </>
  );
}
