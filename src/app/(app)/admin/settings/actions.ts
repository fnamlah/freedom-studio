"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveProviderId, providerHasKey } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import type { Json } from "@/lib/database.types";
import { invalidateSettingsCache } from "@/lib/settings";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";
import { createRouteSupabase, type ServerSupabaseClient } from "@/lib/supabase/server";

import { PROVIDER_LABELS } from "./settings-meta";

/**
 * AI settings mutations — SUPER ADMIN ONLY (docs/11 §3, docs/04 §4.18).
 *
 * Every action gates on `guardedAdminClient(["super_admin"])`, which validates
 * the session, the AAL2 claim and the active `super_admin` profile BEFORE any
 * service credential is materialised. The audited write itself, however, goes
 * through the CALLER's own RLS-scoped client (the Super Admin holds the
 * `app_settings` UPDATE grant): that way the `tg_audit_app_settings` trigger —
 * which stamps the actor from `auth.uid()` — records WHO switched the provider,
 * which is the whole point of the `ai.model_switch` governance verb. A
 * service-role write would leave that audit row's actor NULL.
 *
 * After every write the settings cache is invalidated so the 60 s TTL does not
 * hide the change from the gateway or this page (docs/11 §3, §2.2).
 */

export type SettingsActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/* ------------------------------------------------------------- editable keys --- */

const MODEL_KEYS = [
  "ai.chat_model.moonshot",
  "ai.chat_model.zhipu",
  "ai.vision_model.moonshot",
  "ai.vision_model.zhipu",
  "ai.embedding.model",
] as const;
type ModelKey = (typeof MODEL_KEYS)[number];

const LIMIT_KEYS = [
  "ai.limits.requests_per_user_per_hour",
  "ai.limits.tokens_per_user_per_day",
  "ai.limits.tokens_global_per_day",
] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

const MODEL_LABELS: Record<ModelKey, string> = {
  "ai.chat_model.moonshot": "Moonshot chat model",
  "ai.chat_model.zhipu": "Zhipu chat model",
  "ai.vision_model.moonshot": "Moonshot vision model",
  "ai.vision_model.zhipu": "Zhipu vision model",
  "ai.embedding.model": "Embedding model",
};

const LIMIT_LABELS: Record<LimitKey, string> = {
  "ai.limits.requests_per_user_per_hour": "Requests per user per hour",
  "ai.limits.tokens_per_user_per_day": "Tokens per user per day",
  "ai.limits.tokens_global_per_day": "Tokens per day (global)",
};

const providerSchema = z.enum(["moonshot", "zhipu"]);

const modelValueSchema = z
  .string()
  .trim()
  .min(1, "cannot be empty.")
  .max(120, "is too long.");

const limitValueSchema = z.coerce
  .number()
  .int("must be a whole number.")
  .positive("must be greater than zero.")
  .max(1_000_000_000, "is too large.");

/* ------------------------------------------------------------------ helpers --- */

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "is invalid.";
}

function authzOrGeneric(error: unknown): string {
  if (isAuthzError(error)) return "You are not authorized to change AI settings.";
  return "Something went wrong. Please try again.";
}

function dbError(error: { code?: string; message?: string }): string {
  // 22023 is what validate_app_setting raises for a value that fails its rule.
  if (error.code === "22023") {
    return "That value was rejected by the database validation rule.";
  }
  return "Could not save the setting. Please try again.";
}

/**
 * Applies each `{key, value}` write through the caller's RLS-scoped client so
 * the DB audit trigger attributes it to the acting Super Admin. Stops at the
 * first error. Unchanged values simply no-op the audit trigger (it only fires
 * when the value is DISTINCT), so re-saving is safe.
 */
async function applyWrites(
  supabase: ServerSupabaseClient,
  userId: string,
  entries: Array<{ key: string; value: Json }>,
): Promise<SettingsActionResult> {
  for (const { key, value } of entries) {
    const { data, error } = await supabase
      .from("app_settings")
      .update({ value, updated_by: userId })
      .eq("key", key)
      .select("key")
      .maybeSingle();

    if (error) return { ok: false, error: dbError(error) };
    if (!data) return { ok: false, error: `Unknown setting: ${key}.` };
  }
  return { ok: true };
}

/* --------------------------------------------------------- switch provider --- */

/**
 * Switches the active chat provider (`ai.active_provider`). The DB trigger
 * audits this as `ai.model_switch` with the old and new value — a deliberate
 * governance event (docs/11 §3): switching the third-party data processor is
 * never implicit.
 */
export async function switchActiveProvider(input: {
  provider: string;
}): Promise<SettingsActionResult> {
  const parsed = providerSchema.safeParse(input.provider);
  if (!parsed.success) return { ok: false, error: "Choose Moonshot or Zhipu." };
  const provider = parsed.data;

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(supabase, user.id, [
      { key: "ai.active_provider", value: provider },
    ]);
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: `Active provider switched to ${PROVIDER_LABELS[provider]}. Effective within 60 seconds.`,
    };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error) };
  }
}

/* ------------------------------------------------------------- save models --- */

/**
 * Saves changed model IDs (`ai.chat_model.*`, `ai.vision_model.*`,
 * `ai.embedding.model`). Only keys present in `values` are written, so the
 * client sends only what actually changed. Each write is audited as
 * `ai.settings_update` by the DB trigger.
 */
export async function saveAiModels(input: {
  values: Partial<Record<ModelKey, string>>;
}): Promise<SettingsActionResult> {
  const entries: Array<{ key: string; value: Json }> = [];

  for (const key of MODEL_KEYS) {
    const raw = input.values?.[key];
    if (raw === undefined) continue;
    const parsed = modelValueSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `${MODEL_LABELS[key]} ${firstIssue(parsed.error)}` };
    }
    entries.push({ key, value: parsed.data });
  }

  if (entries.length === 0) return { ok: true, message: "No changes to save." };

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(supabase, user.id, entries);
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return { ok: true, message: entries.length === 1 ? "Model updated." : "Models updated." };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error) };
  }
}

/* ------------------------------------------------------------- save limits --- */

/**
 * Saves changed budget knobs (`ai.limits.*`), the caps the gateway enforces
 * against `ai_usage` before any provider call (docs/11 §8). Positive integers
 * only; the DB validator enforces the same rule.
 */
export async function saveAiLimits(input: {
  values: Partial<Record<LimitKey, number | string>>;
}): Promise<SettingsActionResult> {
  const entries: Array<{ key: string; value: Json }> = [];

  for (const key of LIMIT_KEYS) {
    const raw = input.values?.[key];
    if (raw === undefined) continue;
    const parsed = limitValueSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: `${LIMIT_LABELS[key]} ${firstIssue(parsed.error)}` };
    }
    entries.push({ key, value: parsed.data });
  }

  if (entries.length === 0) return { ok: true, message: "No changes to save." };

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(supabase, user.id, entries);
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return { ok: true, message: entries.length === 1 ? "Budget updated." : "Budgets updated." };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error) };
  }
}

/* -------------------------------------------------------- provider key probe --- */

export type KeyStatus = {
  active: ProviderId;
  configured: Record<ProviderId, boolean>;
  activeConfigured: boolean;
};

/**
 * Re-reads whether each provider key is present, without ever exposing the key
 * value (docs/11 §1 non-negotiable 4 — keys are server-only). SA-gated; returns
 * booleans only.
 */
export async function refreshKeyStatus(): Promise<
  { ok: true; status: KeyStatus } | { ok: false; error: string }
> {
  try {
    await guardedAdminClient(["super_admin"]);
    const active = await getActiveProviderId();
    const configured: Record<ProviderId, boolean> = {
      moonshot: providerHasKey("moonshot"),
      zhipu: providerHasKey("zhipu"),
    };
    return { ok: true, status: { active, configured, activeConfigured: configured[active] } };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error) };
  }
}
