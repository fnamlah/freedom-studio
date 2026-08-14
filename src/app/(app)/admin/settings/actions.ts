"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveProviderId, providerHasKey } from "@/lib/ai/provider";
import type { ProviderId } from "@/lib/ai/types";
import type { Json } from "@/lib/database.types";
import type { Dictionary } from "@/lib/i18n";
import { getDict } from "@/lib/i18n/server";
import { invalidateSettingsCache } from "@/lib/settings";
import { guardedAdminClient, isAuthzError } from "@/lib/supabase/admin";
import { createRouteSupabase, type ServerSupabaseClient } from "@/lib/supabase/server";
import { firstIssue } from "@/lib/forms";

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

const providerSchema = z.enum(["moonshot", "zhipu"]);

/**
 * Both value schemas are FACTORIES rather than module constants.
 *
 * A schema built at import time is built before any request exists, so its
 * messages could only ever be in one language. Calling the factory inside the
 * action — after `getDict()` — is what lets the validation text follow the
 * reader. The messages are sentence FRAGMENTS on purpose: the dictionary's
 * `fieldIssue(label, issue)` decides how a label and a fragment join, which
 * differs between "Moonshot chat model cannot be empty." and «Поле «…»: не
 * может быть пустым.»
 */
const modelValueSchema = (d: Dictionary) =>
  z
    .string()
    .trim()
    .min(1, d.adminAi.settings.issueEmpty)
    .max(120, d.adminAi.settings.issueTooLong);

const limitValueSchema = (d: Dictionary) =>
  z.coerce
    .number()
    .int(d.adminAi.settings.issueNotInteger)
    .positive(d.adminAi.settings.issueNotPositive)
    .max(1_000_000_000, d.adminAi.settings.issueTooLarge);

/* ------------------------------------------------------------------ helpers --- */

function authzOrGeneric(error: unknown, d: Dictionary): string {
  if (isAuthzError(error)) return d.adminAi.settings.errNotAuthorized;
  return d.common.unknownError;
}

function dbError(error: { code?: string; message?: string }, d: Dictionary): string {
  // 22023 is what validate_app_setting raises for a value that fails its rule.
  if (error.code === "22023") {
    return d.adminAi.settings.errDbRejected;
  }
  return d.adminAi.settings.errSaveFailed;
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
  d: Dictionary,
): Promise<SettingsActionResult> {
  for (const { key, value } of entries) {
    const { data, error } = await supabase
      .from("app_settings")
      .update({ value, updated_by: userId })
      .eq("key", key)
      .select("key")
      .maybeSingle();

    if (error) return { ok: false, error: dbError(error, d) };
    if (!data) return { ok: false, error: d.adminAi.settings.errUnknownSetting(key) };
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
  const dictionary = await getDict();
  const d = dictionary.adminAi.settings;

  const parsed = providerSchema.safeParse(input.provider);
  if (!parsed.success) return { ok: false, error: d.errChooseProvider };
  const provider = parsed.data;

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(
      supabase,
      user.id,
      [{ key: "ai.active_provider", value: provider }],
      dictionary,
    );
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return { ok: true, message: d.okSwitched(PROVIDER_LABELS[provider]) };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error, dictionary) };
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
  const dictionary = await getDict();
  const d = dictionary.adminAi.settings;
  const schema = modelValueSchema(dictionary);
  const entries: Array<{ key: string; value: Json }> = [];

  for (const key of MODEL_KEYS) {
    const raw = input.values?.[key];
    if (raw === undefined) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: d.fieldIssue(d.modelLabels[key], firstIssue(parsed.error, d.issueInvalid)),
      };
    }
    entries.push({ key, value: parsed.data });
  }

  if (entries.length === 0) return { ok: true, message: d.okNoChanges };

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(supabase, user.id, entries, dictionary);
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: entries.length === 1 ? d.okModelUpdated : d.okModelsUpdated,
    };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error, dictionary) };
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
  const dictionary = await getDict();
  const d = dictionary.adminAi.settings;
  const schema = limitValueSchema(dictionary);
  const entries: Array<{ key: string; value: Json }> = [];

  for (const key of LIMIT_KEYS) {
    const raw = input.values?.[key];
    if (raw === undefined) continue;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: d.fieldIssue(d.limitLabels[key], firstIssue(parsed.error, d.issueInvalid)),
      };
    }
    entries.push({ key, value: parsed.data });
  }

  if (entries.length === 0) return { ok: true, message: d.okNoChanges };

  try {
    const { user } = await guardedAdminClient(["super_admin"]);
    const supabase = await createRouteSupabase();

    const res = await applyWrites(supabase, user.id, entries, dictionary);
    if (!res.ok) return res;

    invalidateSettingsCache();
    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: entries.length === 1 ? d.okBudgetUpdated : d.okBudgetsUpdated,
    };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error, dictionary) };
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
      openai: providerHasKey("openai"),
    };
    return { ok: true, status: { active, configured, activeConfigured: configured[active] } };
  } catch (error) {
    return { ok: false, error: authzOrGeneric(error, await getDict()) };
  }
}
