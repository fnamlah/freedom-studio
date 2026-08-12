"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

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
  const d = useDict();
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
        success(d.money.ledger.closeToastOk, res.message);
        router.refresh();
      } else {
        error(d.money.ledger.closeToastErr, res.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        {d.money.ledger.closeCta}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={d.money.ledger.closeTitle}
        description={d.money.ledger.closeDesc}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {result ? d.money.ledger.closeDone : d.common.cancel}
            </Button>
            <Button type="submit" form="close-period-form" loading={isRunning}>
              {d.money.ledger.closeRun}
            </Button>
          </>
        }
      >
        <form id="close-period-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="close-start" required>
                {d.money.ledger.closePeriodStart}
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
                {d.money.ledger.closePeriodEnd}
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
              <p className="font-medium text-foreground">{d.money.ledger.closeRunComplete}</p>
              {/* One translated sentence rather than emphasised fragments: the
                  counts inflect the noun in Russian (1 доля / 2 доли / 5 долей),
                  which no amount of JSX interleaving can express. */}
              <p className="mt-1 text-muted">
                {d.money.ledger.closeResult(result.posted, result.skipped)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">{d.money.ledger.closeHint}</p>
          )}
        </form>
      </Dialog>
    </>
  );
}
