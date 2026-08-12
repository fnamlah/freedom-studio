"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

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
  const d = useDict();
  const dr = d.adminAi.reports;
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await generateMonthlyReport();
      if (result.ok) {
        success(dr.toastGenerated, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(result.notConfigured ? dr.toastNotConfigured : dr.toastFailed, result.error);
        if (result.notConfigured) setOpen(false);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        {dr.generateCta}
      </Button>
      <Dialog
        open={open}
        onClose={() => !isRunning && setOpen(false)}
        dismissible={!isRunning}
        title={dr.dialogTitle}
        description={dr.dialogDescription}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button onClick={confirm} loading={isRunning}>
              {dr.confirmCta}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{dr.dialogBody}</p>
      </Dialog>
    </>
  );
}
