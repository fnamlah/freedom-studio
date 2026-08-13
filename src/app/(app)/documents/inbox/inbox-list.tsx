"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n";

import {
  applyDocumentMeta,
  applyEarnings,
  applyExpenses,
  applySessions,
  dismissExtraction,
  type ActionResult,
} from "./actions";

/**
 * Stable identity for removable rows. Keying by array index would let React
 * reuse the DOM node at each position after a removal, bleeding half-typed
 * date segments and keyboard focus into the row that slides up.
 */
let nextRowKey = 0;
type Keyed<T> = T & { _key: string };
const withKeys = <T,>(rows: T[]): Keyed<T>[] =>
  rows.map((row) => ({ ...row, _key: `row-${nextRowKey++}` }));

/**
 * The review queue (021): each card is one proposal — rows the AI read out of
 * one uploaded file — with every value editable, because the human is the
 * author of record and the AI only drafted. Apply sends the EDITED rows to the
 * server, which validates them with the same schemas as the manual forms;
 * nothing on this screen writes anything by itself.
 *
 * The page resolves printed platform/username pairs to accounts server-side
 * where the match is unambiguous; anything else arrives unresolved and the
 * reviewer picks. The printed strings stay visible under each select so she
 * can check the match — the document is the source of truth, not the guess.
 */

/* ------------------------------------------------------------- view models --- */

export type EarningRowView = {
  platform_account_id: string;
  printedPlatform: string;
  printedUsername: string;
  period_start: string;
  period_end: string;
  gross_amount: string;
  platform_fee_amount: string;
  net_amount: string;
  currency: string;
};

export type SessionRowView = {
  platform_account_id: string;
  printedPlatform: string;
  printedUsername: string;
  started_at: string;
  ended_at: string;
  gross_earnings: string;
  currency: string;
  notes: string;
};

export type ExpenseRowView = {
  incurred_on: string;
  vendor: string;
  description: string;
  amount: string;
  currency: string;
  category: string;
};

export type MetaFieldKey = "doc_type" | "title" | "issued_date" | "expires_at";

export type MetaFieldView = {
  key: MetaFieldKey;
  /** Rendered label of the current value (page resolves enum labels). */
  currentLabel: string;
  proposed: string;
};

type ProposalBase = {
  id: string;
  sourceLabel: string;
  sourceGone: boolean;
  createdAt: string;
  /** Pre-formatted for display (locale-correct percent), null when absent. */
  confidenceLabel: string | null;
};

export type ProposalView = ProposalBase &
  (
    | { kind: "earnings"; rows: EarningRowView[] }
    | { kind: "sessions"; rows: SessionRowView[] }
    | { kind: "expenses"; rows: ExpenseRowView[] }
    | { kind: "document_meta"; fields: MetaFieldView[] }
    /** Payload failed its schema. `originalKind` keeps the badge honest. */
    | { kind: "invalid"; originalKind: "earnings" | "sessions" | "expenses" | "document_meta" }
  );

/* ------------------------------------------------------------------- shell --- */

const KIND_BADGE: Record<string, "primary" | "neutral" | "warning" | "muted"> = {
  earnings: "primary",
  sessions: "neutral",
  expenses: "warning",
  document_meta: "muted",
  invalid: "muted",
};

export function InboxList({
  proposals,
  accountOptions,
  docTypeOptions,
}: {
  proposals: ProposalView[];
  accountOptions: SelectOption[];
  docTypeOptions: SelectOption[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          accountOptions={accountOptions}
          docTypeOptions={docTypeOptions}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  accountOptions,
  docTypeOptions,
}: {
  proposal: ProposalView;
  accountOptions: SelectOption[];
  docTypeOptions: SelectOption[];
}) {
  const d = useDict();
  const t = d.documents.inbox;
  const router = useRouter();
  const { success, error } = useToast();
  const [isRunning, startTransition] = useTransition();

  // Row state lives HERE, not in the editors, so Apply submits exactly what is
  // on screen. Initialized from the server-resolved proposal once; a refresh
  // after a decision replaces the whole card.
  const [earningRows, setEarningRows] = useState<Keyed<EarningRowView>[]>(() =>
    withKeys(proposal.kind === "earnings" ? proposal.rows : []),
  );
  const [sessionRows, setSessionRows] = useState<Keyed<SessionRowView>[]>(() =>
    withKeys(proposal.kind === "sessions" ? proposal.rows : []),
  );
  const [expenseRows, setExpenseRows] = useState<Keyed<ExpenseRowView>[]>(() =>
    withKeys(proposal.kind === "expenses" ? proposal.rows : []),
  );
  const [metaFields, setMetaFields] = useState<(MetaFieldView & { include: boolean })[]>(
    proposal.kind === "document_meta"
      ? proposal.fields.map((f) => ({ ...f, include: true }))
      : [],
  );

  function run(fn: () => Promise<ActionResult>, okTitle: string, errTitle: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        success(okTitle, result.message);
        router.refresh();
      } else {
        error(errTitle, result.error);
        // Decided elsewhere (another tab, another reviewer): refresh so the
        // stale card disappears instead of erroring forever. Validation
        // failures don't refresh — that would discard the reviewer's edits.
        if (result.gone) router.refresh();
      }
    });
  }

  const unresolvedCount =
    proposal.kind === "earnings"
      ? earningRows.filter((r) => !r.platform_account_id).length
      : proposal.kind === "sessions"
        ? sessionRows.filter((r) => !r.platform_account_id).length
        : 0;

  const applyDisabled =
    isRunning ||
    proposal.kind === "invalid" ||
    unresolvedCount > 0 ||
    (proposal.kind === "earnings" && earningRows.length === 0) ||
    (proposal.kind === "sessions" && sessionRows.length === 0) ||
    (proposal.kind === "expenses" && expenseRows.length === 0) ||
    (proposal.kind === "document_meta" &&
      metaFields.every((f) => !f.include || !f.proposed.trim()));

  function apply() {
    if (proposal.kind === "earnings") {
      run(
        () =>
          applyEarnings({
            extraction_id: proposal.id,
            rows: earningRows.map((r) => ({
              platform_account_id: r.platform_account_id,
              period_start: r.period_start,
              period_end: r.period_end,
              gross_amount: r.gross_amount,
              platform_fee_amount: r.platform_fee_amount,
              net_amount: r.net_amount,
              currency: r.currency,
            })),
          }),
        t.applyToastOk,
        t.applyToastErr,
      );
    } else if (proposal.kind === "sessions") {
      run(
        () =>
          applySessions({
            extraction_id: proposal.id,
            rows: sessionRows.map((r) => ({
              platform_account_id: r.platform_account_id,
              started_at: r.started_at,
              ended_at: r.ended_at || null,
              gross_earnings: r.gross_earnings,
              currency: r.currency,
              notes: r.notes || null,
            })),
          }),
        t.applyToastOk,
        t.applyToastErr,
      );
    } else if (proposal.kind === "expenses") {
      run(
        () =>
          applyExpenses({
            extraction_id: proposal.id,
            rows: expenseRows.map((r) => ({
              incurred_on: r.incurred_on,
              vendor: r.vendor,
              description: r.description || null,
              amount: r.amount,
              currency: r.currency,
              category: r.category || null,
            })),
          }),
        t.applyToastOk,
        t.applyToastErr,
      );
    } else if (proposal.kind === "document_meta") {
      const fields: Record<string, string> = {};
      for (const f of metaFields) {
        if (f.include && f.proposed.trim()) fields[f.key] = f.proposed.trim();
      }
      run(
        () => applyDocumentMeta({ extraction_id: proposal.id, fields }),
        t.applyToastOk,
        t.applyToastErr,
      );
    }
  }

  function dismiss() {
    run(() => dismissExtraction({ extraction_id: proposal.id }), t.dismissToastOk, t.dismissToastErr);
  }

  const kindLabel =
    proposal.kind === "invalid" ? t.kind[proposal.originalKind] : t.kind[proposal.kind];

  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Badge variant={KIND_BADGE[proposal.kind]}>{kindLabel}</Badge>
        <span className="text-sm font-medium text-foreground">
          {proposal.sourceGone ? t.sourceGone : proposal.sourceLabel}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted">
          {proposal.confidenceLabel ? <span>{t.confidence(proposal.confidenceLabel)}</span> : null}
          <span>{t.proposedOn(proposal.createdAt)}</span>
        </span>
      </header>

      <div className="px-4 py-4">
        {proposal.kind === "invalid" ? (
          <p className="text-sm text-muted">{t.errPayloadInvalid}</p>
        ) : proposal.kind === "earnings" ? (
          <EarningsEditor
            rows={earningRows}
            setRows={setEarningRows}
            accountOptions={accountOptions}
            t={t}
          />
        ) : proposal.kind === "sessions" ? (
          <SessionsEditor
            rows={sessionRows}
            setRows={setSessionRows}
            accountOptions={accountOptions}
            t={t}
          />
        ) : proposal.kind === "expenses" ? (
          <ExpensesEditor rows={expenseRows} setRows={setExpenseRows} t={t} />
        ) : (
          <MetaEditor fields={metaFields} setFields={setMetaFields} docTypeOptions={docTypeOptions} t={t} />
        )}

        {unresolvedCount > 0 ? (
          <p className="mt-3 text-xs text-danger">{t.unresolvedHint}</p>
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={dismiss} disabled={isRunning}>
          {t.dismiss}
        </Button>
        {proposal.kind === "invalid" ? null : (
          <Button size="sm" onClick={apply} loading={isRunning} disabled={applyDisabled}>
            {t.apply}
          </Button>
        )}
      </footer>
    </section>
  );
}

/* ----------------------------------------------------------------- editors --- */

type InboxDict = Dictionary["documents"]["inbox"];

/** Wide grids scroll inside the card rather than stretching the page. */
function GridScroller({ children, minWidth }: { children: React.ReactNode; minWidth: string }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }} className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}

function updateAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

function removeAt<T>(rows: T[], index: number): T[] {
  return rows.filter((_, i) => i !== index);
}

const EARNINGS_GRID = "grid grid-cols-[1.8fr_1fr_1fr_0.9fr_0.8fr_0.9fr_0.6fr_2rem] items-start gap-2";

function EarningsEditor({
  rows,
  setRows,
  accountOptions,
  t,
}: {
  rows: Keyed<EarningRowView>[];
  setRows: (rows: Keyed<EarningRowView>[]) => void;
  accountOptions: SelectOption[];
  t: InboxDict;
}) {
  const d = useDict();
  return (
    <GridScroller minWidth="56rem">
      <div className={`${EARNINGS_GRID} text-xs font-medium text-muted`}>
        <span>{t.colAccount}</span>
        <span>{t.colPeriodStart}</span>
        <span>{t.colPeriodEnd}</span>
        <span>{t.colGross}</span>
        <span>{t.colFee}</span>
        <span>{t.colNet}</span>
        <span>{t.colCurrency}</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={row._key} className={EARNINGS_GRID}>
          <div className="min-w-0">
            <Select
              aria-label={t.colAccount}
              options={accountOptions}
              placeholder={t.chooseAccount}
              value={row.platform_account_id}
              onChange={(e) => setRows(updateAt(rows, i, { platform_account_id: e.target.value }))}
            />
            <PrintedHint row={row} t={t} unresolved={!row.platform_account_id} />
          </div>
          <Input
            type="date"
            aria-label={t.colPeriodStart}
            value={row.period_start}
            onChange={(e) => setRows(updateAt(rows, i, { period_start: e.target.value }))}
          />
          <Input
            type="date"
            aria-label={t.colPeriodEnd}
            value={row.period_end}
            onChange={(e) => setRows(updateAt(rows, i, { period_end: e.target.value }))}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={t.colGross}
            value={row.gross_amount}
            onChange={(e) => setRows(updateAt(rows, i, { gross_amount: e.target.value }))}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={t.colFee}
            value={row.platform_fee_amount}
            onChange={(e) => setRows(updateAt(rows, i, { platform_fee_amount: e.target.value }))}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={t.colNet}
            value={row.net_amount}
            onChange={(e) => setRows(updateAt(rows, i, { net_amount: e.target.value }))}
          />
          <Input
            aria-label={t.colCurrency}
            value={row.currency}
            maxLength={3}
            onChange={(e) => setRows(updateAt(rows, i, { currency: e.target.value }))}
          />
          <RemoveRowButton onClick={() => setRows(removeAt(rows, i))} label={t.removeRow} />
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm text-muted">{d.documents.inbox.errNoRows}</p> : null}
    </GridScroller>
  );
}

const SESSIONS_GRID = "grid grid-cols-[1.8fr_1.2fr_1.2fr_0.9fr_0.6fr_1.4fr_2rem] items-start gap-2";

function SessionsEditor({
  rows,
  setRows,
  accountOptions,
  t,
}: {
  rows: Keyed<SessionRowView>[];
  setRows: (rows: Keyed<SessionRowView>[]) => void;
  accountOptions: SelectOption[];
  t: InboxDict;
}) {
  const d = useDict();
  return (
    <GridScroller minWidth="60rem">
      <div className={`${SESSIONS_GRID} text-xs font-medium text-muted`}>
        <span>{t.colAccount}</span>
        <span>{t.colStarted}</span>
        <span>{t.colEnded}</span>
        <span>{t.colGross}</span>
        <span>{t.colCurrency}</span>
        <span>{t.colNotes}</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={row._key} className={SESSIONS_GRID}>
          <div className="min-w-0">
            <Select
              aria-label={t.colAccount}
              options={accountOptions}
              placeholder={t.chooseAccount}
              value={row.platform_account_id}
              onChange={(e) => setRows(updateAt(rows, i, { platform_account_id: e.target.value }))}
            />
            <PrintedHint row={row} t={t} unresolved={!row.platform_account_id} />
          </div>
          <Input
            type="datetime-local"
            aria-label={t.colStarted}
            value={row.started_at}
            onChange={(e) => setRows(updateAt(rows, i, { started_at: e.target.value }))}
          />
          <Input
            type="datetime-local"
            aria-label={t.colEnded}
            value={row.ended_at}
            onChange={(e) => setRows(updateAt(rows, i, { ended_at: e.target.value }))}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={t.colGross}
            value={row.gross_earnings}
            onChange={(e) => setRows(updateAt(rows, i, { gross_earnings: e.target.value }))}
          />
          <Input
            aria-label={t.colCurrency}
            value={row.currency}
            maxLength={3}
            onChange={(e) => setRows(updateAt(rows, i, { currency: e.target.value }))}
          />
          <Input
            aria-label={t.colNotes}
            value={row.notes}
            onChange={(e) => setRows(updateAt(rows, i, { notes: e.target.value }))}
          />
          <RemoveRowButton onClick={() => setRows(removeAt(rows, i))} label={t.removeRow} />
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm text-muted">{d.documents.inbox.errNoRows}</p> : null}
    </GridScroller>
  );
}

const EXPENSES_GRID = "grid grid-cols-[1fr_1.4fr_1.8fr_0.9fr_0.6fr_1fr_2rem] items-start gap-2";

function ExpensesEditor({
  rows,
  setRows,
  t,
}: {
  rows: Keyed<ExpenseRowView>[];
  setRows: (rows: Keyed<ExpenseRowView>[]) => void;
  t: InboxDict;
}) {
  const d = useDict();
  return (
    <GridScroller minWidth="56rem">
      <div className={`${EXPENSES_GRID} text-xs font-medium text-muted`}>
        <span>{t.colDate}</span>
        <span>{t.colVendor}</span>
        <span>{t.colDescription}</span>
        <span>{t.colAmount}</span>
        <span>{t.colCurrency}</span>
        <span>{t.colCategory}</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={row._key} className={EXPENSES_GRID}>
          <Input
            type="date"
            aria-label={t.colDate}
            value={row.incurred_on}
            onChange={(e) => setRows(updateAt(rows, i, { incurred_on: e.target.value }))}
          />
          <Input
            aria-label={t.colVendor}
            value={row.vendor}
            onChange={(e) => setRows(updateAt(rows, i, { vendor: e.target.value }))}
          />
          <Input
            aria-label={t.colDescription}
            value={row.description}
            onChange={(e) => setRows(updateAt(rows, i, { description: e.target.value }))}
          />
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={t.colAmount}
            value={row.amount}
            onChange={(e) => setRows(updateAt(rows, i, { amount: e.target.value }))}
          />
          <Input
            aria-label={t.colCurrency}
            value={row.currency}
            maxLength={3}
            onChange={(e) => setRows(updateAt(rows, i, { currency: e.target.value }))}
          />
          <Input
            aria-label={t.colCategory}
            value={row.category}
            onChange={(e) => setRows(updateAt(rows, i, { category: e.target.value }))}
          />
          <RemoveRowButton onClick={() => setRows(removeAt(rows, i))} label={t.removeRow} />
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm text-muted">{d.documents.inbox.errNoRows}</p> : null}
    </GridScroller>
  );
}

function MetaEditor({
  fields,
  setFields,
  docTypeOptions,
  t,
}: {
  fields: (MetaFieldView & { include: boolean })[];
  setFields: (fields: (MetaFieldView & { include: boolean })[]) => void;
  docTypeOptions: SelectOption[];
  t: InboxDict;
}) {
  const grid = "grid grid-cols-[6rem_1fr_1fr_5rem] items-center gap-3";
  return (
    <div className="flex flex-col gap-2">
      <div className={`${grid} text-xs font-medium text-muted`}>
        <span>{t.metaField}</span>
        <span>{t.metaCurrent}</span>
        <span>{t.metaProposed}</span>
        <span className="text-center">{t.metaApplyField}</span>
      </div>
      {fields.map((field, i) => (
        <div key={field.key} className={grid}>
          <span className="text-sm text-foreground">{t.field[field.key]}</span>
          <span className="truncate text-sm text-muted">{field.currentLabel || t.metaNone}</span>
          {field.key === "doc_type" ? (
            <Select
              aria-label={t.metaProposed}
              options={docTypeOptions}
              value={field.proposed}
              onChange={(e) => setFields(updateAt(fields, i, { proposed: e.target.value }))}
            />
          ) : (
            <Input
              type={field.key === "title" ? "text" : "date"}
              aria-label={t.metaProposed}
              value={field.proposed}
              onChange={(e) => setFields(updateAt(fields, i, { proposed: e.target.value }))}
            />
          )}
          <div className="flex justify-center">
            <input
              type="checkbox"
              aria-label={t.metaApplyField}
              checked={field.include}
              onChange={(e) => setFields(updateAt(fields, i, { include: e.target.checked }))}
              className="h-4 w-4 rounded border-border bg-surface accent-primary"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- helpers --- */

/**
 * What the document PRINTS, kept under the account select: the reviewer checks
 * the match against the source, not against the AI's guess.
 */
function PrintedHint({
  row,
  t,
  unresolved,
}: {
  row: { printedPlatform: string; printedUsername: string };
  t: InboxDict;
  unresolved: boolean;
}) {
  const hasPrinted = row.printedPlatform || row.printedUsername;
  return (
    <p className={`mt-1 text-xs ${unresolved ? "text-danger" : "text-muted"}`}>
      {hasPrinted
        ? t.printed(row.printedPlatform || "?", row.printedUsername || "?")
        : t.printedUnknown}
    </p>
  );
}

function RemoveRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mt-2 rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      ✕
    </button>
  );
}
