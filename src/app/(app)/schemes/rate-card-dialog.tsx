"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { toNumber } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { saveRateCard } from "./actions";
import {
  COMMISSION_PARTIES,
  studioRemainder,
  type CommissionParty,
  type RateRow,
} from "./rate-card";

/**
 * The studio rate card for one commission scheme (025) — Super Admin only.
 *
 * Laid out as the owner states it: one block per ROLE, each with its own
 * income levels, because the roles genuinely have different thresholds (the
 * model's break at 1501/2500, the operator's and team leader's at 1501/3000).
 * A grid with shared columns would imply an alignment that does not exist.
 *
 * The card saves WHOLE, in one transaction (024's lesson), and the server
 * additionally proves no team composition can be paid more than 100% of a
 * week. The live preview below shows the same arithmetic before saving, so an
 * over-100% card is visible rather than merely rejected.
 */

type LevelDraft = { key: string; min_amount: string; percent: string };
type CardDraft = Record<CommissionParty, LevelDraft[]>;

let nextKey = 0;
const draftKey = () => `lvl-${nextKey++}`;

function toDraft(rows: readonly RateRow[]): CardDraft {
  const draft = {} as CardDraft;
  for (const party of COMMISSION_PARTIES) {
    draft[party] = rows
      .filter((r) => r.party === party)
      .sort((a, b) => a.min_amount - b.min_amount)
      .map((r) => ({
        key: draftKey(),
        min_amount: String(r.min_amount),
        percent: String(r.percent),
      }));
  }
  return draft;
}

/** Draft → the shape both the preview and the server action consume. */
function toRows(draft: CardDraft): RateRow[] {
  const rows: RateRow[] = [];
  for (const party of COMMISSION_PARTIES) {
    for (const level of draft[party]) {
      const min = toNumber(level.min_amount);
      const pct = toNumber(level.percent);
      if (min === null || pct === null) continue;
      rows.push({ party, min_amount: min, percent: pct });
    }
  }
  return rows;
}

/** Weekly-net figures the preview prices — one just inside each real bracket. */
const PREVIEW_WEEKS = [1000, 2000, 2750, 3500];

const COMPOSITIONS = ["independent", "with_coach", "with_operator", "full"] as const;

export function RateCardDialog({
  schemeId,
  scopeLabel,
  rates,
}: {
  schemeId: string;
  scopeLabel: string;
  rates: RateRow[];
}) {
  const router = useRouter();
  const d = useDict();
  const fm = fmt(useLocale());
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [draft, setDraft] = useState<CardDraft>(() => toDraft(rates));

  const t = d.money.schemes.rates;

  function openDialog() {
    setDraft(toDraft(rates));
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function setLevel(party: CommissionParty, key: string, patch: Partial<LevelDraft>) {
    setDraft((prev) => ({
      ...prev,
      [party]: prev[party].map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function addLevel(party: CommissionParty) {
    setDraft((prev) => {
      const existing = prev[party];
      const last = existing[existing.length - 1];
      return {
        ...prev,
        // First level of a role starts at 0 — a role with no zero row earns
        // nothing below its lowest threshold, which the server refuses.
        [party]: [
          ...existing,
          {
            key: draftKey(),
            min_amount: existing.length === 0 ? "0" : "",
            percent: last?.percent ?? "",
          },
        ],
      };
    });
  }

  function removeLevel(party: CommissionParty, key: string) {
    setDraft((prev) => ({ ...prev, [party]: prev[party].filter((l) => l.key !== key) }));
  }

  const rows = useMemo(() => toRows(draft), [draft]);
  const levelCount = rows.length;

  // Any composition paying out more than it takes in, at any preview week.
  const overHundred = useMemo(
    () =>
      PREVIEW_WEEKS.some((week) =>
        COMPOSITIONS.some((c) => studioRemainder(rows, week, c) < 0),
      ),
    [rows],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveRateCard({
        scheme_id: schemeId,
        rates: rows.map((r) => ({
          party: r.party,
          min_amount: r.min_amount,
          percent: r.percent,
        })),
      });
      if (result.ok) {
        success(t.toastOk, result.message);
        setOpen(false);
        router.refresh();
      } else {
        error(t.toastErr, result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        {rates.length > 0 ? t.ctaCount(rates.length) : t.cta}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        dismissible={!isRunning}
        title={t.title}
        description={scopeLabel}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={isRunning}>
              {d.common.cancel}
            </Button>
            <Button type="submit" form="rate-card-form" loading={isRunning} disabled={overHundred}>
              {t.save}
            </Button>
          </>
        }
      >
        <form id="rate-card-form" onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t.description}</p>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            <p>{t.basis}</p>
            <p className="mt-1">{t.composition}</p>
            <p className="mt-1">{t.cliff}</p>
          </div>

          {levelCount === 0 ? (
            <div className="rounded-md border border-border px-3 py-6 text-center">
              <p className="text-sm text-foreground">{t.empty}</p>
              <p className="mt-1 text-xs text-muted">{t.emptyHint}</p>
            </div>
          ) : null}

          {COMMISSION_PARTIES.map((party) => (
            <section key={party} className="rounded-md border border-border px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">{t.party[party]}</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => addLevel(party)}>
                  {t.addLevel}
                </Button>
              </div>

              {draft[party].length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[1fr_1fr_5rem] items-center gap-2 text-xs font-medium text-muted">
                    <span>{t.colFrom}</span>
                    <span>{t.colPercent}</span>
                    <span />
                  </div>
                  {draft[party].map((level, i) => (
                    <div key={level.key} className="grid grid-cols-[1fr_1fr_5rem] items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        required
                        aria-label={`${t.party[party]} — ${t.colFrom}`}
                        placeholder={i === 0 ? t.baseLevel : undefined}
                        value={level.min_amount}
                        onChange={(e) => setLevel(party, level.key, { min_amount: e.target.value })}
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step="0.01"
                        required
                        aria-label={`${t.party[party]} — ${t.colPercent}`}
                        value={level.percent}
                        onChange={(e) => setLevel(party, level.key, { percent: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t.removeLevel}
                        onClick={() => removeLevel(party, level.key)}
                      >
                        {d.common.delete}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

          {levelCount > 0 ? (
            <RatePreview
              rows={rows}
              overHundred={overHundred}
              fmPercent={fm.percent}
              fmMoney={fm.money}
            />
          ) : null}
        </form>
      </Dialog>
    </>
  );
}

/**
 * What a week of each size actually pays out, per composition. This is the
 * card's meaning made visible: the same lookup the close performs, run over a
 * few representative weeks, with the studio's remainder spelled out — the one
 * number nobody enters and everybody cares about.
 */
function RatePreview({
  rows,
  overHundred,
  fmPercent,
  fmMoney,
}: {
  rows: RateRow[];
  overHundred: boolean;
  fmPercent: (value: number) => string;
  fmMoney: (value: number) => string;
}) {
  const d = useDict();
  const t = d.money.schemes.rates;

  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-foreground">{t.previewHeading}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-3 py-2 text-start font-medium">{t.previewWeek}</th>
              {COMPOSITIONS.map((c) => (
                <th key={c} className="px-3 py-2 text-end font-medium">
                  {t.compositionLabel[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PREVIEW_WEEKS.map((week) => (
              <tr key={week} className="border-t border-border">
                <td className="px-3 py-2 tabular-nums text-muted">{fmMoney(week)}</td>
                {COMPOSITIONS.map((c) => {
                  const left = studioRemainder(rows, week, c);
                  return (
                    <td
                      key={c}
                      className={`px-3 py-2 text-end tabular-nums ${
                        left < 0 ? "text-danger" : "text-foreground"
                      }`}
                    >
                      {fmPercent(left)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3 py-2 text-xs text-muted">{t.previewStudio}</p>
      {overHundred ? (
        <p className="border-t border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t.overHundredWarning}
        </p>
      ) : null}
    </div>
  );
}
