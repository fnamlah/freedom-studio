import type { Database } from "@/lib/database.types";
import { dict, type Locale } from "@/lib/i18n";

/**
 * Role vocabulary — CLIENT-SAFE.
 *
 * Kept separate from `@/lib/auth/guard` (which pulls in `next/headers` and is
 * therefore server-only) so client components can import role values without
 * dragging server modules into the browser bundle. `guard.ts` re-exports
 * everything here, so server code can keep importing from a single place.
 */

/** The five authenticated roles (docs/03-roles-rbac.md §1). */
export type Role = Database["public"]["Enums"]["user_role"];

export const ROLES: readonly Role[] = [
  "super_admin",
  "manager",
  "model",
  "finance",
  "operator",
] as const;

/**
 * The display name of a role, in the reader's language.
 *
 * A role is a DB enum value (`super_admin`), which is never translated; only its
 * label is. Callers that already know the locale — server components via
 * `getLocale()`, client components via `useLocale()` — should use these two
 * helpers rather than the English maps below.
 */
export function roleLabel(locale: Locale, role: Role): string {
  return dict(locale).roles[role];
}

/** Short description of what a role may do, in the reader's language. */
export function roleDescription(locale: Locale, role: Role): string {
  return dict(locale).authFlow.roleDescriptions[role];
}

/**
 * English-only compatibility views over the dictionary, kept because several
 * surfaces still index them directly. Derived rather than duplicated, so the
 * dictionary stays the single source of truth; prefer `roleLabel()` /
 * `roleDescription()` in anything user-facing.
 */
export const ROLE_LABELS: Record<Role, string> = dict("en").roles;

/** Short descriptions, for admin surfaces that assign roles. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = dict("en").authFlow.roleDescriptions;

/** Runtime narrowing for values arriving from query strings or forms. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
