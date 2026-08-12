"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";

import { setDocumentAnalysisOptIn } from "./actions";
import { aiStatusLabel, type KeyFigure } from "./ai-meta";

/**
 * AI analysis panel for one compliance document (migration 014).
 *
 * These documents contain third parties' identity data, so analysis is
 * off by default and requires an explicit per-document opt-in — the toggle here
 * is the consent record, and flipping it is an audited event. Analysis itself
 * is driven client-side against `/api/ai/analyse-document`, exactly like the
 * Library classifier, so the crossing, audit and metering all live server-side.
 */
export function AnalysisManager({
  documentId,
  documentTitle,
  optedIn,
  aiStatus,
  summary,
  keyFigures,
  analysedProvider,
}: {
  documentId: string;
  documentTitle: string;
  optedIn: boolean;
  aiStatus: string;
  summary: string | null;
  keyFigures: KeyFigure[];
  analysedProvider: string | null;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const d = useDict();
  const a = d.documents.analysis;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [analysing, setAnalysing] = useState(false);

  function toggleOptIn(next: boolean) {
    startTransition(async () => {
      const res = await setDocumentAnalysisOptIn({ document_id: documentId, opt_in: next });
      if (res.ok) {
        success(next ? a.enabledTitle : a.disabledTitle, res.message);
        router.refresh();
      } else {
        error(a.updateFailedTitle, res.error);
      }
    });
  }

  async function runAnalysis() {
    setAnalysing(true);
    try {
      const res = await fetch("/api/ai/analyse-document", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        configured?: boolean;
        status?: string;
        reason?: string;
        error?: string;
      };
      if (body.configured === false) {
        error(a.notConfiguredTitle, a.notConfiguredBody);
      } else if (!res.ok) {
        error(a.failedTitle, body.error ?? a.pleaseTryAgain);
      } else if (body.status === "analysed") {
        success(a.analysedTitle, a.analysedBody);
        router.refresh();
      } else {
        error(
          a.notCompletedTitle,
          a.notCompletedBody(body.status ?? a.statusUnknown, body.reason ?? a.reasonUnknown),
        );
      }
    } catch {
      error(a.failedTitle, a.pleaseTryAgain);
    } finally {
      setAnalysing(false);
    }
  }

  const hasAnalysis = Boolean(summary) || keyFigures.length > 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {optedIn ? (hasAnalysis ? a.btnAnalysis : a.btnAnalyse) : a.btnAi}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={a.title}
        description={a.description(truncate(documentTitle, 60))}
        size="lg"
      >
        <div className="flex flex-col gap-5">
          {/* Consent -------------------------------------------------------- */}
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{a.consentTitle}</p>
                <p className="mt-1 text-xs text-muted">{a.consentBody}</p>
              </div>
              <Button
                variant={optedIn ? "secondary" : "primary"}
                size="sm"
                loading={pending}
                onClick={() => toggleOptIn(!optedIn)}
              >
                {optedIn ? a.disable : a.enable}
              </Button>
            </div>
            {optedIn ? (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="primary" dot>
                  {a.optedIn}
                </Badge>
                <span className="text-xs text-muted">
                  {a.statusLine(aiStatusLabel(a.status, aiStatus), analysedProvider)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Run + results -------------------------------------------------- */}
          {optedIn ? (
            <>
              <div className="flex justify-end">
                <Button size="sm" loading={analysing} onClick={runAnalysis}>
                  {hasAnalysis ? a.reanalyse : a.analyseNow}
                </Button>
              </div>

              {summary ? (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">
                    {a.summaryHeading}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">{summary}</p>
                </div>
              ) : null}

              {keyFigures.length > 0 ? (
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">
                    {a.keyFiguresHeading}
                  </p>
                  <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                    {keyFigures.map((f, i) => (
                      <div key={i} className="flex items-start justify-between gap-4 px-3 py-2">
                        <dt className="text-xs text-muted">{f.label}</dt>
                        <dd className="text-right text-sm font-medium tabular-nums text-foreground">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {!hasAnalysis ? <p className="text-sm text-muted">{a.noAnalysis}</p> : null}
            </>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
