import type { Metadata } from "next";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, StatTileRow } from "@/components/ui/stat-tile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireRole } from "@/lib/auth/guard";
import { EM_DASH } from "@/lib/format";

import { AccountForm, type ModelOption, type PlatformOption } from "./account-form";
import { AccountsTable, type AccountRowView } from "./accounts-table";
import { PlatformForm } from "./platform-form";
import { PlatformsTable, type PlatformRowView } from "./platforms-table";
import type { AccountStatus } from "./status";

export const metadata: Metadata = { title: "Platforms" };

/**
 * Platforms & accounts — Super Admin + Manager only (docs/03 §3, docs/04 §7.2:
 * platforms and platform_accounts are full CRUD for SA/MGR).
 *
 * Reads go through the caller's own RLS-scoped client. Model names and platform
 * names are resolved server-side into flat view rows (following the model-detail
 * pattern of building lookup Maps rather than relying on nested-select typing),
 * so the client tables render plain strings.
 */
export default async function PlatformsPage() {
  const { supabase } = await requireRole("super_admin", "manager");

  const [platformsResult, accountsResult, modelsResult] = await Promise.all([
    supabase
      .from("platforms")
      .select("id, name, website_url, is_active")
      .order("name", { ascending: true }),
    supabase
      .from("platform_accounts")
      .select("id, model_id, platform_id, username, status, platform_fee_percent, created_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("models")
      .select("id, stage_name, status")
      .order("stage_name", { ascending: true }),
  ]);

  const platforms = platformsResult.data ?? [];
  const accounts = accountsResult.data ?? [];
  const models = modelsResult.data ?? [];

  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const modelName = new Map(models.map((m) => [m.id, m.stage_name]));

  const accountCount = new Map<string, number>();
  for (const account of accounts) {
    accountCount.set(account.platform_id, (accountCount.get(account.platform_id) ?? 0) + 1);
  }

  const platformRows: PlatformRowView[] = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    website_url: p.website_url,
    is_active: p.is_active,
    account_count: accountCount.get(p.id) ?? 0,
  }));

  const accountRows: AccountRowView[] = accounts.map((a) => ({
    id: a.id,
    model_id: a.model_id,
    model_name: modelName.get(a.model_id) ?? EM_DASH,
    platform_name: platformName.get(a.platform_id) ?? EM_DASH,
    username: a.username,
    platform_fee_percent: a.platform_fee_percent,
    status: a.status as AccountStatus,
  }));

  const modelOptions: ModelOption[] = models.map((m) => ({
    id: m.id,
    stage_name: m.stage_name,
  }));
  const platformOptions: PlatformOption[] = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    is_active: p.is_active,
  }));

  const counts = {
    platforms: platforms.length,
    activePlatforms: platforms.filter((p) => p.is_active).length,
    accounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.status === "active").length,
  };

  return (
    <>
      <PageHeader
        title="Platforms"
        description="The webcam platforms the studio works with, and each model's accounts on them."
        breadcrumbs={[{ label: "Platforms" }]}
        actions={
          <>
            <PlatformForm mode="create" />
            <AccountForm
              mode="create"
              models={modelOptions}
              platforms={platformOptions}
            />
          </>
        }
      />

      <StatTileRow className="mb-6" columns={4}>
        <StatTile label="Platforms" value={counts.platforms} hint="On record" />
        <StatTile label="Active platforms" value={counts.activePlatforms} hint="Currently in use" />
        <StatTile label="Accounts" value={counts.accounts} hint="Across all models" />
        <StatTile label="Active accounts" value={counts.activeAccounts} hint="Currently working" />
      </StatTileRow>

      <Tabs defaultValue="platforms">
        <TabsList ariaLabel="Platforms sections">
          <TabsTrigger value="platforms" badge={<Count value={platformRows.length} />}>
            Platforms
          </TabsTrigger>
          <TabsTrigger value="accounts" badge={<Count value={accountRows.length} />}>
            Accounts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="platforms">
          <Card>
            <CardHeader
              title="Platforms"
              description="A platform can't be deleted once accounts reference it (docs/04 §4.5) — deactivate it instead."
            />
            <CardBody flush>
              <PlatformsTable rows={platformRows} />
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardHeader
              title="Platform accounts"
              description="Every model's account across the studio's platforms. Usernames are unique per model and platform."
            />
            <CardBody flush>
              <AccountsTable rows={accountRows} />
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">
      {value}
    </span>
  );
}
