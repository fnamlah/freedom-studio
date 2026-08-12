import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireRole } from "@/lib/auth/guard";
import type { Database } from "@/lib/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import { EM_DASH } from "@/lib/format";
import { fmt } from "@/lib/i18n/format";
import { getDict, getLocale } from "@/lib/i18n/server";

import { ModelForm, type EditableModel } from "../model-form";
import { modelStatusMeta, type ModelStatus } from "../status";
import { StatusControl } from "./detail-actions";

type AccountStatus = Database["public"]["Enums"]["account_status"];

/** Badge colour per account status; the label comes from `d.studio.accountStatus`. */
const ACCOUNT_STATUS_VARIANT: Record<AccountStatus, BadgeVariant> = {
  active: "success",
  suspended: "warning",
  closed: "muted",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const d = await getDict();
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("models")
    .select("stage_name")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.stage_name ?? d.studio.models.detailMetaFallback };
}

/**
 * Model detail — Super Admin + Manager only (docs/03 §3, docs/04 §7.2).
 *
 * All reads go through the caller's RLS-scoped client. Sensitive columns
 * (`legal_name`, `date_of_birth`) render here because this route is gated to the
 * only two roles that may read them. Compliance counts come from the derived
 * `v_model_compliance_summary` view (docs/07), never from stored columns.
 */
export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireRole("super_admin", "manager");
  const d = await getDict();
  const fm = fmt(await getLocale());

  const { data: model } = await supabase
    .from("models")
    .select(
      "id, stage_name, legal_name, date_of_birth, email, phone, country, start_date, status, commission_percent, notes, profile_id, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!model) {
    notFound();
  }

  const [accountsResult, platformsResult, earningsResult, documentsResult, complianceResult] =
    await Promise.all([
      supabase
        .from("platform_accounts")
        .select("id, username, status, platform_fee_percent, platform_id")
        .eq("model_id", id)
        .order("created_at", { ascending: true }),
      supabase.from("platforms").select("id, name"),
      supabase
        .from("earnings")
        .select("id, period_start, period_end, gross_amount, net_amount, currency, platform_account_id")
        .eq("model_id", id)
        .order("period_end", { ascending: false })
        .limit(10),
      supabase.from("documents").select("id, is_archived").eq("model_id", id),
      supabase
        .from("v_model_compliance_summary")
        .select("valid_count, expiring_count, expired_count")
        .eq("model_id", id)
        .maybeSingle(),
    ]);

  const accounts = accountsResult.data ?? [];
  const earnings = earningsResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const compliance = complianceResult.data;

  const platformName = new Map((platformsResult.data ?? []).map((p) => [p.id, p.name]));
  const accountName = new Map(
    accounts.map((a) => [a.id, { username: a.username, platform: platformName.get(a.platform_id) ?? null }]),
  );

  const documentsTotal = documents.length;
  const documentsActive = documents.filter((doc) => !doc.is_archived).length;
  const validCount = compliance?.valid_count ?? 0;
  const expiringCount = compliance?.expiring_count ?? 0;
  const expiredCount = compliance?.expired_count ?? 0;

  const statusMeta = modelStatusMeta(d, model.status);

  const editable: EditableModel = {
    id: model.id,
    stage_name: model.stage_name,
    legal_name: model.legal_name,
    date_of_birth: model.date_of_birth,
    email: model.email,
    phone: model.phone,
    country: model.country,
    start_date: model.start_date,
    commission_percent: model.commission_percent,
    notes: model.notes,
  };

  return (
    <>
      <PageHeader
        title={model.stage_name}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge variant={statusMeta.variant} dot>
              {statusMeta.label}
            </Badge>
            <span className="text-muted">{model.legal_name}</span>
          </span>
        }
        breadcrumbs={[
          { label: d.studio.models.title, href: "/models" },
          { label: model.stage_name },
        ]}
        actions={
          <>
            <StatusControl id={model.id} status={model.status as ModelStatus} />
            <ModelForm mode="edit" model={editable} />
          </>
        }
      />

      <Tabs defaultValue="profile">
        <TabsList ariaLabel={d.studio.models.tabsAria}>
          <TabsTrigger value="profile">{d.studio.models.tabProfile}</TabsTrigger>
          <TabsTrigger value="accounts" badge={<Count value={accounts.length} />}>
            {d.studio.models.tabAccounts}
          </TabsTrigger>
          <TabsTrigger value="earnings" badge={<Count value={earnings.length} />}>
            {d.studio.models.tabEarnings}
          </TabsTrigger>
          <TabsTrigger value="compliance" badge={<Count value={documentsTotal} />}>
            {d.studio.models.tabCompliance}
          </TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------------- profile --- */}
        <TabsContent value="profile">
          <Card>
            <CardHeader
              title={d.studio.models.profileTitle}
              description={d.studio.models.profileDescription}
            />
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow
                  label={d.studio.models.rowStageName}
                  value={model.stage_name}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowLegalName}
                  value={model.legal_name}
                  sensitive
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowDob}
                  value={fm.date(model.date_of_birth)}
                  sensitive
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowCountry}
                  value={model.country ?? EM_DASH}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowStartDate}
                  value={model.start_date ? fm.date(model.start_date) : EM_DASH}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowStatus}
                  sensitiveLabel={d.studio.models.sensitive}
                  value={
                    <Badge variant={statusMeta.variant} dot>
                      {statusMeta.label}
                    </Badge>
                  }
                />
                <DetailRow
                  label={d.studio.models.rowCommissionLegacy}
                  value={fm.percent(model.commission_percent)}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowEmail}
                  value={model.email ?? EM_DASH}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowPhone}
                  value={model.phone ?? EM_DASH}
                  sensitiveLabel={d.studio.models.sensitive}
                />
                <DetailRow
                  label={d.studio.models.rowSelfService}
                  sensitiveLabel={d.studio.models.sensitive}
                  value={
                    model.profile_id ? (
                      <Badge variant="primary">{d.studio.models.linked}</Badge>
                    ) : (
                      <Badge variant="muted">{d.studio.models.notLinked}</Badge>
                    )
                  }
                />
                <DetailRow
                  label={d.studio.models.rowCreated}
                  value={fm.date(model.created_at)}
                  sensitiveLabel={d.studio.models.sensitive}
                />
              </dl>

              {model.notes ? (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
                    {d.studio.models.notesHeading}
                  </p>
                  <p className="text-sm whitespace-pre-wrap text-foreground">{model.notes}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- accounts --- */}
        <TabsContent value="accounts">
          <Card>
            <CardHeader
              title={d.studio.models.accountsTitle}
              description={d.studio.models.accountsDescription}
            />
            <CardBody flush>
              {accounts.length === 0 ? (
                <EmptyState
                  bare
                  title={d.studio.models.accountsEmptyTitle}
                  description={d.studio.models.accountsEmptyDescription}
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{d.studio.models.colPlatform}</TH>
                      <TH>{d.studio.models.colUsername}</TH>
                      <TH align="right">{d.studio.models.colPlatformFee}</TH>
                      <TH>{d.studio.models.rowStatus}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {accounts.map((account) => (
                      <TR key={account.id}>
                        <TD className="font-medium text-foreground">
                          {platformName.get(account.platform_id) ?? EM_DASH}
                        </TD>
                        <TD className="text-muted">{account.username}</TD>
                        <TD numeric>
                          {account.platform_fee_percent === null
                            ? EM_DASH
                            : fm.percent(account.platform_fee_percent)}
                        </TD>
                        <TD>
                          <Badge variant={ACCOUNT_STATUS_VARIANT[account.status]} dot>
                            {d.studio.accountStatus[account.status]}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- earnings --- */}
        <TabsContent value="earnings">
          <Card>
            <CardHeader
              title={d.studio.models.earningsTitle}
              description={d.studio.models.earningsDescription}
            />
            <CardBody flush>
              {earnings.length === 0 ? (
                <EmptyState
                  bare
                  title={d.studio.models.earningsEmptyTitle}
                  description={d.studio.models.earningsEmptyDescription}
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{d.studio.models.colPeriod}</TH>
                      <TH>{d.studio.models.colAccount}</TH>
                      <TH align="right">{d.studio.models.colGross}</TH>
                      <TH align="right">{d.studio.models.colNet}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {earnings.map((row) => {
                      const acct = accountName.get(row.platform_account_id);
                      return (
                        <TR key={row.id}>
                          <TD className="text-muted">
                            {fm.dateRange(row.period_start, row.period_end)}
                          </TD>
                          <TD>
                            {acct ? (
                              <>
                                <span className="text-foreground">{acct.platform ?? EM_DASH}</span>
                                <span className="ml-1.5 text-xs text-muted">{acct.username}</span>
                              </>
                            ) : (
                              EM_DASH
                            )}
                          </TD>
                          <TD numeric>{fm.money(row.gross_amount, row.currency)}</TD>
                          <TD numeric className="font-medium text-foreground">
                            {fm.money(row.net_amount, row.currency)}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------- compliance --- */}
        <TabsContent value="compliance">
          <StatTileRow columns={4} className="mb-6">
            <StatTile
              label={d.studio.models.statDocuments}
              value={documentsTotal}
              hint={d.studio.models.statDocumentsHint(documentsActive)}
            />
            <StatTile
              label={d.studio.models.statValid}
              value={validCount}
              hint={d.studio.models.statValidHint}
            />
            <StatTile
              label={d.studio.models.statExpiring}
              value={expiringCount}
              hint={d.studio.models.statExpiringHint}
            />
            <StatTile
              label={d.studio.models.statExpired}
              value={expiredCount}
              hint={d.studio.models.statExpiredHint}
            />
          </StatTileRow>

          <Card>
            <CardHeader
              title={d.studio.models.complianceTitle}
              description={d.studio.models.complianceDescription}
            />
            <CardBody>
              {documentsTotal === 0 ? (
                <EmptyState
                  bare
                  title={d.studio.models.complianceEmptyTitle}
                  description={d.studio.models.complianceEmptyDescription}
                />
              ) : expiredCount > 0 ? (
                <p className="text-sm text-danger">
                  {d.studio.models.complianceExpired(expiredCount)}
                </p>
              ) : expiringCount > 0 ? (
                <p className="text-sm text-warning">
                  {d.studio.models.complianceExpiring(expiringCount)}
                </p>
              ) : (
                <p className="text-sm text-success">{d.studio.models.complianceAllValid}</p>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function DetailRow({
  label,
  value,
  sensitive = false,
  sensitiveLabel,
}: {
  label: string;
  value: ReactNode;
  sensitive?: boolean;
  sensitiveLabel: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        {label}
        {sensitive ? (
          <Badge variant="muted" className="px-1.5 py-0 text-[10px] normal-case">
            {sensitiveLabel}
          </Badge>
        ) : null}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">
      {value}
    </span>
  );
}
