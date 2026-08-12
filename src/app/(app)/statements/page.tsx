import type { Metadata } from "next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/guard";
import type { Enums } from "@/lib/database.types";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { StatementControls, type PayeeOption } from "./statement-controls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).money.statements.metaTitle };
}

type LedgerEntryType = Enums<"ledger_entry_type">;

/**
 * Badge colour per entry type; the LABEL comes from `d.money.ledger.entryType`,
 * shared with the ledger page so the two never drift apart in either language.
 */
const ENTRY_VARIANT: Record<LedgerEntryType, BadgeVariant> = {
  earning_share: "success",
  adjustment: "primary",
  deduction: "warning",
  payout_settlement: "muted",
};

type StatementLine = {
  amount: number | null;
  currency: string | null;
  description: string | null;
  entry_date: string | null;
  entry_id: number | null;
  entry_type: LedgerEntryType | null;
  line_type: string | null;
  running_balance: number | null;
};

function isValidYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Payee statements — the payee-facing rendering of the ledger via
 * `fn_payee_statement(payee_type, payee_id, from, to)` (docs/09 §7): opening
 * balance (sum of entries before `from`), the body entries in order, and the
 * closing balance. The RPC is SECURITY INVOKER, so a model/operator can only ever
 * produce their own statement while finance/SA can produce anyone's — enforced by
 * RLS, not application filtering. Because the ledger is append-only, a past-period
 * statement is reproducible forever.
 */
export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ payee?: string; from?: string; to?: string }>;
}) {
  const { supabase } = await requireRole(
    "super_admin",
    "manager",
    "finance",
    "model",
    "operator",
  );
  const { payee, from, to } = await searchParams;
  const d = await getDict();
  const fm = fmt(await getLocale());

  const [modelDir, operatorDir] = await Promise.all([
    supabase.from("v_model_directory").select("id, stage_name"),
    supabase.from("v_operator_directory").select("id, display_name"),
  ]);

  const models = modelDir.data ?? [];
  const operators = operatorDir.data ?? [];

  const payeeOptions: PayeeOption[] = [
    ...models
      .filter((m): m is { id: string; stage_name: string } => !!m.id)
      .map((m) => ({
        value: `model:${m.id}`,
        label: `${m.stage_name ?? d.money.ledger.fallbackModel} · ${d.money.ledger.payeeType.model}`,
      })),
    ...operators
      .filter((o): o is { id: string; display_name: string } => !!o.id)
      .map((o) => ({
        value: `operator:${o.id}`,
        label: `${o.display_name ?? d.money.ledger.fallbackOperator} · ${d.money.ledger.payeeType.operator}`,
      })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const payeeLabel = new Map(payeeOptions.map((o) => [o.value, o.label]));
  const validPayees = new Set(payeeOptions.map((o) => o.value));

  /* --------------------------------------------------------- parse & guard --- */

  const activePayee = payee && validPayees.has(payee) ? payee : "";
  const activeFrom = from && isValidYmd(from) ? from : "";
  const activeTo = to && isValidYmd(to) ? to : "";
  const hasQuery = activePayee !== "" && activeFrom !== "" && activeTo !== "";
  const orderValid = hasQuery ? activeTo >= activeFrom : true;

  /* ------------------------------------------------------------- statement --- */

  let lines: StatementLine[] = [];
  let rpcError = false;

  if (hasQuery && orderValid) {
    const [payeeType, payeeId] = activePayee.split(":");
    const { data, error } = await supabase.rpc("fn_payee_statement", {
      p_payee_type: payeeType as "model" | "operator",
      p_payee_id: payeeId,
      p_from: activeFrom,
      p_to: activeTo,
    });
    if (error) {
      rpcError = true;
    } else {
      lines = (data ?? []) as StatementLine[];
    }
  }

  // Be tolerant of the RPC's exact `line_type` labels: anything starting with
  // "open"/"clos" is the synthetic opening/closing marker; everything else is body.
  const isOpening = (l: StatementLine) => (l.line_type ?? "").toLowerCase().startsWith("open");
  const isClosing = (l: StatementLine) => (l.line_type ?? "").toLowerCase().startsWith("clos");
  const opening = lines.find(isOpening);
  const closing = lines.find(isClosing);
  const body = lines.filter((l) => !isOpening(l) && !isClosing(l));

  const openingBalance = opening
    ? Number(opening.running_balance ?? opening.amount ?? 0)
    : 0;
  const closingBalance = closing
    ? Number(closing.running_balance ?? 0)
    : body.length > 0
      ? Number(body[body.length - 1]?.running_balance ?? openingBalance)
      : openingBalance;

  const currencyCode =
    body.find((l) => l.currency)?.currency ?? opening?.currency ?? "USD";
  const movement = closingBalance - openingBalance;

  return (
    <>
      <PageHeader
        title={d.money.statements.title}
        description={d.money.statements.description}
        breadcrumbs={[{ label: d.money.statements.title }]}
      />

      <div className="mb-6">
        <StatementControls
          payees={payeeOptions}
          current={{ payee: activePayee, from: activeFrom, to: activeTo }}
        />
      </div>

      {payeeOptions.length === 0 ? (
        <EmptyState
          title={d.money.statements.noPayeesTitle}
          description={d.money.statements.noPayeesDesc}
        />
      ) : !hasQuery ? (
        <EmptyState
          title={d.money.statements.pickTitle}
          description={d.money.statements.pickDesc}
        />
      ) : !orderValid ? (
        <EmptyState
          title={d.money.statements.datesTitle}
          description={d.money.statements.datesDesc}
        />
      ) : rpcError ? (
        <EmptyState
          title={d.money.statements.errorTitle}
          description={d.money.statements.errorDesc}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {payeeLabel.get(activePayee) ?? d.money.statements.headingFallback}
              </h2>
              <p className="text-xs text-muted">{fm.dateRange(activeFrom, activeTo)}</p>
            </div>
            <span className="text-xs text-muted">
              {d.money.statements.entriesCount(body.length)}
            </span>
          </div>

          <StatTileRow className="mb-6" columns={3}>
            <StatTile
              label={d.money.statements.openingBalance}
              value={fm.money(openingBalance, currencyCode)}
              hint={d.money.statements.openingHint(fm.date(activeFrom))}
            />
            <StatTile
              label={d.money.statements.movement}
              value={fm.money(movement, currencyCode, { signed: true })}
              hint={d.money.statements.movementHint}
            />
            <StatTile
              label={d.money.statements.closingBalance}
              value={fm.money(closingBalance, currencyCode)}
              hint={d.money.statements.closingHint(fm.date(activeTo))}
            />
          </StatTileRow>

          {body.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-muted">
                  {d.money.statements.noEntriesInWindow(fm.money(openingBalance, currencyCode))}
                </p>
              </CardBody>
            </Card>
          ) : (
            <Table containerClassName="rounded-lg border border-border">
              <THead>
                <TR>
                  <TH>{d.money.statements.colDate}</TH>
                  <TH>{d.money.statements.colType}</TH>
                  <TH>{d.money.statements.colDescription}</TH>
                  <TH align="right">{d.money.statements.colAmount}</TH>
                  <TH align="right">{d.money.statements.colBalance}</TH>
                </TR>
              </THead>
              <TBody>
                {/* Opening balance as the first row for continuity */}
                <TR>
                  <TD className="whitespace-nowrap text-muted">{fm.date(activeFrom)}</TD>
                  <TD>
                    <Badge variant="neutral">{d.money.statements.rowOpening}</Badge>
                  </TD>
                  <TD className="text-muted">{d.money.statements.rowOpeningDesc}</TD>
                  <TD numeric className="text-muted">
                    —
                  </TD>
                  <TD numeric className="font-medium text-foreground">
                    {fm.money(openingBalance, currencyCode)}
                  </TD>
                </TR>

                {body.map((line, i) => {
                  const amount = Number(line.amount ?? 0);
                  return (
                    <TR key={line.entry_id ?? `line-${i}`}>
                      <TD className="whitespace-nowrap text-muted">
                        {line.entry_date ? fm.date(line.entry_date) : "—"}
                      </TD>
                      <TD>
                        {line.entry_type ? (
                          <Badge variant={ENTRY_VARIANT[line.entry_type]}>
                            {d.money.ledger.entryType[line.entry_type]}
                          </Badge>
                        ) : (
                          <Badge variant="neutral">{d.money.statements.entryFallback}</Badge>
                        )}
                      </TD>
                      <TD className="text-muted">
                        {line.description ? (
                          <span className="text-foreground">{line.description}</span>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD numeric>
                        <span className={amount < 0 ? "text-danger" : "text-foreground"}>
                          {fm.money(amount, line.currency ?? currencyCode, { signed: true })}
                        </span>
                      </TD>
                      <TD numeric className="text-muted">
                        {fm.money(Number(line.running_balance ?? 0), line.currency ?? currencyCode)}
                      </TD>
                    </TR>
                  );
                })}

                {/* Closing balance footer row */}
                <TR>
                  <TD className="whitespace-nowrap font-medium text-foreground">
                    {fm.date(activeTo)}
                  </TD>
                  <TD>
                    <Badge variant="neutral">{d.money.statements.rowClosing}</Badge>
                  </TD>
                  <TD className="text-muted">{d.money.statements.rowClosingDesc}</TD>
                  <TD numeric className="text-muted">
                    —
                  </TD>
                  <TD numeric className="font-semibold text-foreground">
                    {fm.money(closingBalance, currencyCode)}
                  </TD>
                </TR>
              </TBody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
