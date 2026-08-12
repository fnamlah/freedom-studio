"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

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
  const d = useDict();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await snapshotForecast();
      if (result.ok) {
        success(d.money.forecasts.snapshotToastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(d.money.forecasts.snapshotToastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {d.money.forecasts.snapshotCta}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={d.money.forecasts.snapshotTitle}
        description={d.money.forecasts.snapshotDesc}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              {d.money.forecasts.snapshotCta}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{d.money.forecasts.snapshotBody}</p>
      </Dialog>
    </>
  );
}
