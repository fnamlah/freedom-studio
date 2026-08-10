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
import { date, dateRange, EM_DASH, money, percent } from "@/lib/format";

import { ModelForm, type EditableModel } from "../model-form";
import { MODEL_STATUS_META, type ModelStatus } from "../status";
import { StatusControl } from "./detail-actions";

type AccountStatus = Database["public"]["Enums"]["account_status"];

const ACCOUNT_STATUS_META: Record<AccountStatus, { variant: BadgeVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  suspended: { variant: "warning", label: "Suspended" },
  closed: { variant: "muted", label: "Closed" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("models")
    .select("stage_name")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.stage_name ?? "Model" };
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
  const documentsActive = documents.filter((d) => !d.is_archived).length;
  const validCount = compliance?.valid_count ?? 0;
  const expiringCount = compliance?.expiring_count ?? 0;
  const expiredCount = compliance?.expired_count ?? 0;

  const statusMeta = MODEL_STATUS_META[model.status];

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
        breadcrumbs={[{ label: "Models", href: "/models" }, { label: model.stage_name }]}
        actions={
          <>
            <StatusControl id={model.id} status={model.status as ModelStatus} />
            <ModelForm mode="edit" model={editable} />
          </>
        }
      />

      <Tabs defaultValue="profile">
        <TabsList ariaLabel="Model detail sections">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="accounts" badge={<Count value={accounts.length} />}>
            Platform accounts
          </TabsTrigger>
          <TabsTrigger value="earnings" badge={<Count value={earnings.length} />}>
            Recent earnings
          </TabsTrigger>
          <TabsTrigger value="compliance" badge={<Count value={documentsTotal} />}>
            Documents &amp; compliance
          </TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------------- profile --- */}
        <TabsContent value="profile">
          <Card>
            <CardHeader title="Profile" description="Business record. Sensitive fields are visible to Super Admin and Managers only." />
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow label="Stage name" value={model.stage_name} />
                <DetailRow label="Legal name" value={model.legal_name} sensitive />
                <DetailRow label="Date of birth" value={date(model.date_of_birth)} sensitive />
                <DetailRow label="Country" value={model.country ?? EM_DASH} />
                <DetailRow label="Start date" value={model.start_date ? date(model.start_date) : EM_DASH} />
                <DetailRow
                  label="Status"
                  value={
                    <Badge variant={statusMeta.variant} dot>
                      {statusMeta.label}
                    </Badge>
                  }
                />
                <DetailRow label="Commission (legacy)" value={percent(model.commission_percent)} />
                <DetailRow label="Email" value={model.email ?? EM_DASH} />
                <DetailRow label="Phone" value={model.phone ?? EM_DASH} />
                <DetailRow
                  label="Self-service login"
                  value={
                    model.profile_id ? (
                      <Badge variant="primary">Linked</Badge>
                    ) : (
                      <Badge variant="muted">Not linked</Badge>
                    )
                  }
                />
                <DetailRow label="Created" value={date(model.created_at)} />
              </dl>

              {model.notes ? (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
                    Notes
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
              title="Platform accounts"
              description="Accounts this model holds across the studio's platforms."
            />
            <CardBody flush>
              {accounts.length === 0 ? (
                <EmptyState
                  bare
                  title="No platform accounts"
                  description="Platform accounts are managed from the Platforms module."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Platform</TH>
                      <TH>Username</TH>
                      <TH align="right">Platform fee</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {accounts.map((account) => {
                      const meta = ACCOUNT_STATUS_META[account.status];
                      return (
                        <TR key={account.id}>
                          <TD className="font-medium text-foreground">
                            {platformName.get(account.platform_id) ?? EM_DASH}
                          </TD>
                          <TD className="text-muted">{account.username}</TD>
                          <TD numeric>
                            {account.platform_fee_percent === null
                              ? EM_DASH
                              : percent(account.platform_fee_percent)}
                          </TD>
                          <TD>
                            <Badge variant={meta.variant} dot>
                              {meta.label}
                            </Badge>
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

        {/* ----------------------------------------------------- earnings --- */}
        <TabsContent value="earnings">
          <Card>
            <CardHeader
              title="Recent earnings"
              description="The 10 most recent statement periods. Earnings are the money source of truth (docs/04 §4.7)."
            />
            <CardBody flush>
              {earnings.length === 0 ? (
                <EmptyState
                  bare
                  title="No earnings recorded"
                  description="Statement periods are recorded from the Earnings module."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Period</TH>
                      <TH>Account</TH>
                      <TH align="right">Gross</TH>
                      <TH align="right">Net</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {earnings.map((row) => {
                      const acct = accountName.get(row.platform_account_id);
                      return (
                        <TR key={row.id}>
                          <TD className="text-muted">
                            {dateRange(row.period_start, row.period_end)}
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
                          <TD numeric>{money(row.gross_amount, row.currency)}</TD>
                          <TD numeric className="font-medium text-foreground">
                            {money(row.net_amount, row.currency)}
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
              label="Documents"
              value={documentsTotal}
              hint={`${documentsActive} active`}
            />
            <StatTile label="Valid" value={validCount} hint="Not expiring soon" />
            <StatTile
              label="Expiring"
              value={expiringCount}
              hint="Within 30 days"
            />
            <StatTile label="Expired" value={expiredCount} hint="Past expiry" />
          </StatTileRow>

          <Card>
            <CardHeader
              title="Compliance status"
              description="Derived from document expiry dates (docs/07). Documents live in the Documents module."
            />
            <CardBody>
              {documentsTotal === 0 ? (
                <EmptyState
                  bare
                  title="No documents on file"
                  description="Identity and compliance documents are uploaded from the Documents module."
                />
              ) : expiredCount > 0 ? (
                <p className="text-sm text-danger">
                  {expiredCount} document{expiredCount === 1 ? "" : "s"} expired. Renewal is required
                  to keep this model compliant.
                </p>
              ) : expiringCount > 0 ? (
                <p className="text-sm text-warning">
                  {expiringCount} document{expiringCount === 1 ? "" : "s"} expiring within 30 days.
                  Plan renewals soon.
                </p>
              ) : (
                <p className="text-sm text-success">All documents are valid.</p>
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
}: {
  label: string;
  value: ReactNode;
  sensitive?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        {label}
        {sensitive ? (
          <Badge variant="muted" className="px-1.5 py-0 text-[10px] normal-case">
            Sensitive
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
