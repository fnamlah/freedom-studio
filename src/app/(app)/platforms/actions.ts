"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { dict, toLocale, type Dictionary } from "@/lib/i18n";
import { isAuthzError } from "@/lib/supabase/admin";

/**
 * Platforms & platform-accounts CRUD — Super Admin + Manager only
 * (docs/03 §3, docs/04 §7.2: platforms/platform_accounts are `CRUD` for SA/MGR;
 * model reads own accounts, finance reads all, operators denied).
 *
 * Every action opens with `requireRole("super_admin", "manager")`, which
 * redirects an unauthorized caller BEFORE any work runs — the guard is the hard
 * gate. Writes go through the caller's own RLS-scoped client, so RLS is the final
 * authority on every row. Each mutation appends an `audit_log` row via
 * `writeAudit()` with a dotted-verb action (docs/04 §4.16).
 *
 * Neither `platforms` nor `platform_accounts` carries a `created_by` column
 * (docs/04 §4.4–4.5), so inserts set no actor column — provenance lives in the
 * audit trail instead.
 *
 * Schemas are FACTORIES taking the caller's dictionary: a module-scope schema is
 * built at import time, where no locale exists, so its messages could only ever be
 * English. The language comes off the profile `requireRole()` already loaded.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/* -------------------------------------------------------------- validation --- */

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** Website URL: optional, normalized to include a scheme, then validated. */
const optionalUrl = (d: Dictionary) =>
  z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      if (trimmed === "") return null;
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }, z.string().url(d.studio.platforms.errUrl).max(2048, d.studio.platforms.errUrlLong).nullable())
    .optional();

/** Platform revenue cut: optional (nullable in the schema), 0–100 when present. */
const optionalFeePercent = (d: Dictionary) =>
  z
    .preprocess(
      emptyToNull,
      z.coerce
        .number({ invalid_type_error: d.studio.platforms.errFeeType })
        .min(0, d.studio.platforms.errFeeMin)
        .max(100, d.studio.platforms.errFeeMax)
        .nullable(),
    )
    .optional();

const platformName = (d: Dictionary) =>
  z.string().trim().min(1, d.studio.platforms.errNameRequired).max(160);
const accountUsername = (d: Dictionary) =>
  z.string().trim().min(1, d.studio.platforms.errUsernameRequired).max(160);

const createPlatformSchema = (d: Dictionary) =>
  z.object({
    name: platformName(d),
    website_url: optionalUrl(d),
    is_active: z.boolean(),
  });

const updatePlatformSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(),
    name: platformName(d),
    website_url: optionalUrl(d),
  });

const setPlatformActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

const createAccountSchema = (d: Dictionary) =>
  z.object({
    model_id: z.string().uuid(d.studio.platforms.errModelRequired),
    platform_id: z.string().uuid(d.studio.platforms.errPlatformRequired),
    username: accountUsername(d),
    platform_fee_percent: optionalFeePercent(d),
    status: z.enum(ACCOUNT_STATUSES),
  });

const updateAccountSchema = (d: Dictionary) =>
  z.object({
    id: z.string().uuid(),
    username: accountUsername(d),
    platform_fee_percent: optionalFeePercent(d),
  });

const setAccountStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(ACCOUNT_STATUSES),
});

/* ------------------------------------------------------------------ types --- */

export type CreatePlatformInput = {
  name: string;
  website_url?: string | null;
  is_active: boolean;
};

export type UpdatePlatformInput = {
  id: string;
  name: string;
  website_url?: string | null;
};

export type CreatePlatformAccountInput = {
  model_id: string;
  platform_id: string;
  username: string;
  platform_fee_percent?: string | number | null;
  status: string;
};

export type UpdatePlatformAccountInput = {
  id: string;
  username: string;
  platform_fee_percent?: string | number | null;
};

/* ---------------------------------------------------------------- helpers --- */

function firstIssue(error: z.ZodError, d: Dictionary): string {
  return error.issues[0]?.message ?? d.studio.platforms.errForm;
}

/** Maps a Postgres error to a friendly message; DB constraints back-stop zod. */
function describePlatformError(code: string | undefined, d: Dictionary): string {
  if (code === "23505") {
    return d.studio.platforms.errPlatformDuplicate;
  }
  return d.studio.platforms.errPlatformSaveFailed;
}

function describeAccountError(code: string | undefined, d: Dictionary): string {
  if (code === "23505") {
    return d.studio.platforms.errAccountDuplicate;
  }
  if (code === "23503") {
    return d.studio.platforms.errAccountFk;
  }
  if (code === "23514") {
    return d.studio.platforms.errAccountCheck;
  }
  return d.studio.platforms.errAccountSaveFailed;
}

/* --------------------------------------------------------- platforms: create --- */

export async function createPlatform(input: CreatePlatformInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createPlatformSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("platforms")
      .insert({
        name: data.name,
        website_url: data.website_url ?? null,
        is_active: data.is_active,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describePlatformError(error?.code, d) };
    }

    await writeAudit({
      action: "platform.create",
      entityType: "platform",
      entityId: created.id,
      metadata: { name: data.name, is_active: data.is_active },
    });

    revalidatePath("/platforms");
    return { ok: true, message: d.studio.platforms.msgPlatformAdded(data.name) };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedAddPlatform };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* --------------------------------------------------------- platforms: update --- */

export async function updatePlatform(input: UpdatePlatformInput): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updatePlatformSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("platforms")
      .update({
        name: data.name,
        website_url: data.website_url ?? null,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describePlatformError(error.code, d) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.platforms.errPlatformGone };
    }

    await writeAudit({
      action: "platform.update",
      entityType: "platform",
      entityId: data.id,
      metadata: { name: data.name },
    });

    revalidatePath("/platforms");
    return { ok: true, message: d.studio.platforms.msgPlatformUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedEditPlatform };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------- platforms: active toggle --- */

export async function setPlatformActive(input: {
  id: string;
  is_active: boolean;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = setPlatformActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.platforms.errPlatformInvalid };
  }
  const { id, is_active } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("platforms")
      .select("id, name, is_active")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.studio.platforms.errPlatformLoadFailed };
    }
    if (!current) {
      return { ok: false, error: d.studio.platforms.errPlatformGone };
    }
    if (current.is_active === is_active) {
      return { ok: false, error: d.studio.platforms.msgPlatformAlready(is_active) };
    }

    const { error: updateError } = await supabase
      .from("platforms")
      .update({ is_active })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: d.studio.platforms.errPlatformToggleFailed };
    }

    await writeAudit({
      action: "platform.status_change",
      entityType: "platform",
      entityId: id,
      metadata: { name: current.name, from: current.is_active, to: is_active },
    });

    revalidatePath("/platforms");
    return {
      ok: true,
      message: d.studio.platforms.msgPlatformNow(current.name, is_active),
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedChangePlatform };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------- accounts: create --- */

export async function createPlatformAccount(
  input: CreatePlatformAccountInput,
): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = createAccountSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: created, error } = await supabase
      .from("platform_accounts")
      .insert({
        model_id: data.model_id,
        platform_id: data.platform_id,
        username: data.username,
        platform_fee_percent: data.platform_fee_percent ?? null,
        status: data.status as AccountStatus,
      })
      .select("id")
      .single();

    if (error || !created) {
      return { ok: false, error: describeAccountError(error?.code, d) };
    }

    await writeAudit({
      action: "account.create",
      entityType: "platform_account",
      entityId: created.id,
      metadata: {
        model_id: data.model_id,
        platform_id: data.platform_id,
        username: data.username,
        status: data.status,
      },
    });

    revalidatePath("/platforms");
    revalidatePath(`/models/${data.model_id}`);
    return { ok: true, message: d.studio.platforms.msgAccountAdded(data.username) };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedAddAccount };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ---------------------------------------------------------- accounts: update --- */

export async function updatePlatformAccount(
  input: UpdatePlatformAccountInput,
): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = updateAccountSchema(d).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, d) };
  }
  const data = parsed.data;

  try {
    const { data: updated, error } = await supabase
      .from("platform_accounts")
      .update({
        username: data.username,
        platform_fee_percent: data.platform_fee_percent ?? null,
      })
      .eq("id", data.id)
      .select("id, model_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: describeAccountError(error.code, d) };
    }
    if (!updated) {
      return { ok: false, error: d.studio.platforms.errAccountGone };
    }

    await writeAudit({
      action: "account.update",
      entityType: "platform_account",
      entityId: data.id,
      metadata: { username: data.username },
    });

    revalidatePath("/platforms");
    revalidatePath(`/models/${updated.model_id}`);
    return { ok: true, message: d.studio.platforms.msgAccountUpdated };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedEditAccount };
    }
    return { ok: false, error: d.common.unknownError };
  }
}

/* ------------------------------------------------------ accounts: set status --- */

export async function setPlatformAccountStatus(input: {
  id: string;
  status: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireRole("super_admin", "manager");
  const d = dict(toLocale(profile.locale));

  const parsed = setAccountStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: d.studio.platforms.errAccountInvalidStatus };
  }
  const { id, status } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("platform_accounts")
      .select("id, username, status, model_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: d.studio.platforms.errAccountLoadFailed };
    }
    if (!current) {
      return { ok: false, error: d.studio.platforms.errAccountGone };
    }
    if (current.status === status) {
      return {
        ok: false,
        error: d.studio.platforms.msgAccountAlready(d.studio.accountStatus[status]),
      };
    }

    const { error: updateError } = await supabase
      .from("platform_accounts")
      .update({ status: status as AccountStatus })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: d.studio.platforms.errAccountStatusFailed };
    }

    await writeAudit({
      action: "account.status_change",
      entityType: "platform_account",
      entityId: id,
      metadata: { username: current.username, from: current.status, to: status },
    });

    revalidatePath("/platforms");
    revalidatePath(`/models/${current.model_id}`);
    return {
      ok: true,
      message: d.studio.platforms.msgAccountNow(
        current.username,
        d.studio.accountStatus[status],
      ),
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: d.studio.platforms.errNotAuthorizedAccountStatus };
    }
    return { ok: false, error: d.common.unknownError };
  }
}
