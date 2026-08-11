"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

import { generateMonthlyReport } from "./actions";

/**
 * "Generate monthly report" — Super Admin + Finance only (docs/11 §7).
 *
 * The server action re-guards the role and does all the work: gather the studio's
 * own aggregates through the caller's RLS, pass them through the redaction
 * chokepoint, prompt the active provider, and store the result. This button is a
 * convenience surface; the action is the authority. Disabled when AI is not
 * configured so there is no dead click.
 */
export function GenerateReportButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await generateMonthlyReport();
      if (result.ok) {
        success("Report generated", result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(result.notConfigured ? "AI not configured" : "Could not generate report", result.error);
        if (result.notConfigured) setOpen(false);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        Generate monthly report
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title="Generate this month's market report?"
        description="Builds a commentary from the studio's own aggregate figures — earnings, split distribution, forecast, forecast accuracy and payee balances — and stores it as a report."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              Generate report
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Only de-identified aggregates are sent to the AI provider — no individual names, and no
          document contents. Generating a report counts against the studio&apos;s AI budget and is
          recorded in the audit trail.
        </p>
      </Dialog>
    </>
  );
}
