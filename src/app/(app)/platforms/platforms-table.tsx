"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH } from "@/lib/format";

import { setPlatformActive } from "./actions";
import { PlatformForm, type EditablePlatform } from "./platform-form";
import { PLATFORM_ACTIVE_META, PLATFORM_ACTIVE_OPTIONS } from "./status";

export type PlatformRowView = {
  id: string;
  name: string;
  website_url: string | null;
  is_active: boolean;
  account_count: number;
};

/** Reference list of platforms with an inline activation toggle and edit dialog. */
export function PlatformsTable({ rows }: { rows: PlatformRowView[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        bare
        title="No platforms yet"
        description="Add the webcam platforms the studio works with, then link model accounts."
      />
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Platform</TH>
          <TH>Website</TH>
          <TH align="right">Accounts</TH>
          <TH>Status</TH>
          <TH align="right">
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((platform) => {
          const meta = PLATFORM_ACTIVE_META[platform.is_active ? "active" : "inactive"];
          return (
            <TR key={platform.id}>
              <TD className="font-medium text-foreground">{platform.name}</TD>
              <TD>
                {platform.website_url ? (
                  <a
                    href={platform.website_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {displayHost(platform.website_url)}
                  </a>
                ) : (
                  <span className="text-muted">{EM_DASH}</span>
                )}
              </TD>
              <TD numeric className="text-muted">
                {platform.account_count}
              </TD>
              <TD>
                <Badge variant={meta.variant} dot>
                  {meta.label}
                </Badge>
              </TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-2">
                  <ActiveToggle id={platform.id} isActive={platform.is_active} />
                  <PlatformForm mode="edit" platform={toEditable(platform)} />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function toEditable(platform: PlatformRowView): EditablePlatform {
  return { id: platform.id, name: platform.name, website_url: platform.website_url };
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Inline active/inactive toggle. Fires the dedicated `setPlatformActive` action
 * (audited as `platform.status_change`), reverting on failure — same pattern as
 * the models module's status control.
 */
function ActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [value, setValue] = useState(isActive);
  const [isRunning, startTransition] = useTransition();

  function change(next: boolean) {
    if (next === value) return;
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await setPlatformActive({ id, is_active: next });
      if (result.ok) {
        success("Platform updated", result.message);
        router.refresh();
      } else {
        setValue(previous);
        error("Could not change platform", result.error);
      }
    });
  }

  return (
    <Select
      aria-label="Toggle platform active state"
      className="h-9 w-32"
      options={PLATFORM_ACTIVE_OPTIONS}
      value={value ? "active" : "inactive"}
      disabled={isRunning}
      onChange={(e) => change(e.target.value === "active")}
    />
  );
}
