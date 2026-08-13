"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { toNumber } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { saveSchemeTiers } from "./actions";

/** One rung of the ladder, as the form holds it (strings — these are inputs). */
type TierDraft = {
  key: string;
  min_amount: string;
  model_percent: string;
  operator_percent: string;
  studio_percent: string;
};

export type SchemeTier = {
  min_amount: number;
  model_percent: number;
  operator_percent: number;
  studio_percent: number;
};

let nextKey = 0;
const draftKey = () => `tier-${nextKey++}`;

function toDraft(tier: SchemeTier): TierDraft {
  return {
    key: draftKey(),
    min_amount: String(tier.min_amount),
    model_percent: String(tier.model_percent),
    operator_percent: String(tier.operator_percent),
    studio_percent: String(tier.studio_percent),
  };
}

/**
 * Income tiers for one commission scheme (023) — Super Admin only, the trigger
 * rendered only where `canWrite` holds.
 *
 * The ladder is edited and saved WHOLE: the server replaces it in a single
 * transaction (024), so a scheme can never end up half-tiered. Removing every
 * row and saving is a legitimate action — it returns the scheme to its base
 * percentages, which is what the greyed first row shows.
 *
 * Each rung's three percentages must total 100%, checked live here and enforced
 * by the server action and a DB CHECK. The rows sort by threshold on save, so
 * they can be typed in any order.
 */
export function TierDialog({
  schemeId,
  scopeLabel,
  base,
  tiers,
}: {
  schemeId: string;
  scopeLabel: string;
  /** The scheme's own percentages — what applies below the lowest tier. */
  base: { model_percent: number; operator_percent: number; studio_percent: number };
  tiers: SchemeTier[];
}) {
  const router = useRouter();
  const d = useDict();
  const fm = fmt(useLocale());
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [isRunning, startTransition] = useTransition();
  const [rows, setRows] = useState<TierDraft[]>(() => tiers.map(toDraft));

  const t = d.money.schemes.tiers;

  function openDialog() {
    setRows(tiers.map(toDraft));
    setOpen(true);
  }

  function close() {
    if (isRunning) return;
    setOpen(false);
  }

  function setCell(key: string, field: keyof Omit<TierDraft, "key">, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => {
      // Seed from the last rung so a ladder is built by nudging numbers, not by
      // retyping a whole split each time.
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          key: draftKey(),
          min_amount: "",
          model_percent: last?.model_percent ?? String(base.model_percent),
          operator_percent: last?.operator_percent ?? String(base.operator_percent),
          studio_percent: last?.studio_percent ?? String(base.studio_percent),
        },
      ];
    });
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function rowSum(row: TierDraft): number {
    const m = toNumber(row.model_percent) ?? 0;
    const o = toNumber(row.operator_percent) ?? 0;
    const s = toNumber(row.studio_percent) ?? 0;
    return Math.round((m + o + s) * 100) / 100;
  }

  const allSumOk = rows.every((r) => rowSum(r) === 100);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      const result = await saveSchemeTiers({
        scheme_id: schemeId,
        tiers: rows.map((r) => ({
          min_amount: r.min_amount,
          model_percent: r.model_percent,
          operator_percent: r.operator_percent,
          studio_percent: r.studio_percent,
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
        {tiers.length > 0 ? t.ctaCount(tiers.length) : t.cta}
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
            <Button type="submit" form="tier-form" loading={isRunning} disabled={!allSumOk}>
              {t.save}
            </Button>
          </>
        }
      >
        <form id="tier-form" onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t.description}</p>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            <p>{t.basis}</p>
            <p className="mt-1">{t.cliff}</p>
          </div>

          {/* Column headings, carried once for the base row and every rung.
              `text-center` on the three percentage columns, not `text-right`:
              the rungs below are inputs whose text starts on the LEFT, so a
              right-aligned heading points at nothing. */}
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_5rem] items-center gap-2 text-xs font-medium text-muted">
            <span>{t.colFrom}</span>
            <span className="text-center">{t.colModel}</span>
            <span className="text-center">{t.colTeam}</span>
            <span className="text-center">{t.colStudio}</span>
            <span />
          </div>

          {/* The scheme's own split, shown as the ladder's floor — read-only,
              because it is edited on the scheme itself, not here. Same grid and
              the same gap as a rung, so the figures sit in their columns. */}
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_5rem] items-center gap-2 rounded-md border border-dashed border-border py-2 text-sm text-muted">
            <span className="flex flex-col pl-3">
              <span>{t.baseRow}</span>
              <span className="text-xs opacity-80">{t.baseHint}</span>
            </span>
            <span className="text-center tabular-nums">{fm.percent(base.model_percent)}</span>
            <span className="text-center tabular-nums">{fm.percent(base.operator_percent)}</span>
            <span className="text-center tabular-nums">{fm.percent(base.studio_percent)}</span>
            <span />
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-border px-3 py-6 text-center">
              <p className="text-sm text-foreground">{t.empty}</p>
              <p className="mt-1 text-xs text-muted">{t.emptyHint}</p>
            </div>
          ) : (
            rows.map((row) => {
              const sum = rowSum(row);
              const ok = sum === 100;
              return (
                <div key={row.key} className="flex flex-col gap-1">
                  <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_5rem] items-center gap-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      required
                      aria-label={t.colFrom}
                      value={row.min_amount}
                      onChange={(e) => setCell(row.key, "min_amount", e.target.value)}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      required
                      aria-label={t.colModel}
                      value={row.model_percent}
                      onChange={(e) => setCell(row.key, "model_percent", e.target.value)}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      required
                      aria-label={t.colTeam}
                      value={row.operator_percent}
                      onChange={(e) => setCell(row.key, "operator_percent", e.target.value)}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      required
                      aria-label={t.colStudio}
                      value={row.studio_percent}
                      onChange={(e) => setCell(row.key, "studio_percent", e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(row.key)}
                      aria-label={t.remove}
                    >
                      {d.common.delete}
                    </Button>
                  </div>
                  {ok ? null : (
                    <p className="px-1 text-xs text-danger">
                      {t.sumRule}
                      {" — "}
                      <span className="font-semibold tabular-nums">{fm.percent(sum)}</span>
                    </p>
                  )}
                </div>
              );
            })
          )}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              {t.add}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
