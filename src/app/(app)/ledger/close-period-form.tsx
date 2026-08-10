"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

import { closePeriod } from "./actions";

type Counts = { posted: number; skipped: number };

/**
 * "Close period" — runs `fn_generate_earning_shares(from, to)` (docs/09 §5.3),
 * posting one positive `earning_share` credit per payee for every earning row in
 * the window. The RPC is idempotent (keyed per earning/payee), so re-running after
 * a late earning row lands only posts what is missing — nothing is ever
 * double-credited. Posted/skipped counts are surfaced on success.
 */
export function ClosePeriodForm() {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<Counts | null>(null);

  function openDialog() {
    setStart("");
    setEnd("");
    setResult(null);
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);

    startTransition(async () => {
      const res = await closePeriod({ period_start: start, period_end: end });
      if (res.ok) {
        setResult({ posted: res.posted, skipped: res.skipped });
        success("Period closed", res.message);
        router.refresh();
      } else {
        error("Could not close period", res.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        Close period
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title="Close a statement period"
        description="Generates earning-share credits for every earnings row in the window. Safe to re-run — already-posted shares are skipped (docs/09 §5.3)."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {result ? "Done" : "Cancel"}
            </Button>
            <Button type="submit" form="close-period-form" loading={isRunning}>
              Run share generation
            </Button>
          </>
        }
      >
        <form id="close-period-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="close-start" required>
                Period start
              </Label>
              <Input
                id="close-start"
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="close-end" required>
                Period end
              </Label>
              <Input
                id="close-end"
                type="date"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>

          {result ? (
            <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
              <p className="font-medium text-foreground">Run complete</p>
              <p className="mt-1 text-muted">
                <span className="font-medium text-success">{result.posted}</span> share
                {result.posted === 1 ? "" : "s"} posted ·{" "}
                <span className="font-medium text-foreground">{result.skipped}</span> skipped
                (already posted). Adjust the window and run again if needed.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">
              The scheme in force at each row&apos;s period end governs its split; the studio share
              is the residue, never posted (docs/09 §4–5).
            </p>
          )}
        </form>
      </Dialog>
    </>
  );
}
