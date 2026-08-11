"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
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
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/* -------------------------------------------------------------- validation --- */

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/** Website URL: optional, normalized to include a scheme, then validated. */
const optionalUrl = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const trimmed = v.trim();
    if (trimmed === "") return null;
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }, z.string().url("Enter a valid website URL.").max(2048, "That URL is too long.").nullable())
  .optional();

/** Platform revenue cut: optional (nullable in the schema), 0–100 when present. */
const optionalFeePercent = z
  .preprocess(
    emptyToNull,
    z.coerce
      .number({ invalid_type_error: "Enter a fee percentage." })
      .min(0, "Fee can't be negative.")
      .max(100, "Fee can't exceed 100%.")
      .nullable(),
  )
  .optional();

const platformName = z.string().trim().min(1, "Platform name is required.").max(160);
const accountUsername = z.string().trim().min(1, "Username is required.").max(160);

const createPlatformSchema = z.object({
  name: platformName,
  website_url: optionalUrl,
  is_active: z.boolean(),
});

const updatePlatformSchema = z.object({
  id: z.string().uuid(),
  name: platformName,
  website_url: optionalUrl,
});

const setPlatformActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

const createAccountSchema = z.object({
  model_id: z.string().uuid("Choose a model."),
  platform_id: z.string().uuid("Choose a platform."),
  username: accountUsername,
  platform_fee_percent: optionalFeePercent,
  status: z.enum(ACCOUNT_STATUSES),
});

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  username: accountUsername,
  platform_fee_percent: optionalFeePercent,
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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/** Maps a Postgres error to a friendly message; DB constraints back-stop zod. */
function describePlatformError(code: string | undefined): string {
  if (code === "23505") {
    return "A platform with that name already exists.";
  }
  return "Could not save the platform. Please try again.";
}

function describeAccountError(code: string | undefined): string {
  if (code === "23505") {
    return "That model already has an account with this username on this platform.";
  }
  if (code === "23503") {
    return "The selected model or platform no longer exists.";
  }
  if (code === "23514") {
    return "That doesn't satisfy a database rule — check the platform fee (0–100%).";
  }
  return "Could not save the account. Please try again.";
}

/* --------------------------------------------------------- platforms: create --- */

export async function createPlatform(input: CreatePlatformInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = createPlatformSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describePlatformError(error?.code) };
    }

    await writeAudit({
      action: "platform.create",
      entityType: "platform",
      entityId: created.id,
      metadata: { name: data.name, is_active: data.is_active },
    });

    revalidatePath("/platforms");
    return { ok: true, message: `${data.name} added.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to add platforms." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* --------------------------------------------------------- platforms: update --- */

export async function updatePlatform(input: UpdatePlatformInput): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updatePlatformSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describePlatformError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That platform no longer exists." };
    }

    await writeAudit({
      action: "platform.update",
      entityType: "platform",
      entityId: data.id,
      metadata: { name: data.name },
    });

    revalidatePath("/platforms");
    return { ok: true, message: "Platform updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit platforms." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ---------------------------------------------------- platforms: active toggle --- */

export async function setPlatformActive(input: {
  id: string;
  is_active: boolean;
}): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = setPlatformActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid change." };
  }
  const { id, is_active } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("platforms")
      .select("id, name, is_active")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: "Could not load that platform." };
    }
    if (!current) {
      return { ok: false, error: "That platform no longer exists." };
    }
    if (current.is_active === is_active) {
      return { ok: false, error: `Platform is already ${is_active ? "active" : "inactive"}.` };
    }

    const { error: updateError } = await supabase
      .from("platforms")
      .update({ is_active })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: "Could not change the platform. Please try again." };
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
      message: `${current.name} is now ${is_active ? "active" : "inactive"}.`,
    };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to change platforms." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ---------------------------------------------------------- accounts: create --- */

export async function createPlatformAccount(
  input: CreatePlatformAccountInput,
): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describeAccountError(error?.code) };
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
    return { ok: true, message: `Account ${data.username} added.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to add platform accounts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ---------------------------------------------------------- accounts: update --- */

export async function updatePlatformAccount(
  input: UpdatePlatformAccountInput,
): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
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
      return { ok: false, error: describeAccountError(error.code) };
    }
    if (!updated) {
      return { ok: false, error: "That account no longer exists." };
    }

    await writeAudit({
      action: "account.update",
      entityType: "platform_account",
      entityId: data.id,
      metadata: { username: data.username },
    });

    revalidatePath("/platforms");
    revalidatePath(`/models/${updated.model_id}`);
    return { ok: true, message: "Account updated." };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to edit platform accounts." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/* ------------------------------------------------------ accounts: set status --- */

export async function setPlatformAccountStatus(input: {
  id: string;
  status: string;
}): Promise<ActionResult> {
  const { supabase } = await requireRole("super_admin", "manager");

  const parsed = setAccountStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid status change." };
  }
  const { id, status } = parsed.data;

  try {
    const { data: current, error: readError } = await supabase
      .from("platform_accounts")
      .select("id, username, status, model_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return { ok: false, error: "Could not load that account." };
    }
    if (!current) {
      return { ok: false, error: "That account no longer exists." };
    }
    if (current.status === status) {
      return { ok: false, error: `Account is already ${status}.` };
    }

    const { error: updateError } = await supabase
      .from("platform_accounts")
      .update({ status: status as AccountStatus })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: "Could not change the status. Please try again." };
    }

    await writeAudit({
      action: "account.status_change",
      entityType: "platform_account",
      entityId: id,
      metadata: { username: current.username, from: current.status, to: status },
    });

    revalidatePath("/platforms");
    revalidatePath(`/models/${current.model_id}`);
    return { ok: true, message: `${current.username} is now ${status}.` };
  } catch (error) {
    if (isAuthzError(error)) {
      return { ok: false, error: "You are not authorized to change account status." };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
