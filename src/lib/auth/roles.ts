import type { Database } from "@/lib/database.types";

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

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  manager: "Studio Manager",
  model: "Model",
  finance: "Finance",
  operator: "Operator",
};

/** Short descriptions, for admin surfaces that assign roles. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Studio owner. Full control; sole payout approver and audit-log reader.",
  manager: "Day-to-day operations. No user administration, no financial authorization.",
  model: "Self-service access to their own records, earnings and documents.",
  finance: "Money only. No access to identity or compliance documents.",
  operator: "Self-service support staff. Sees their own ledger share and payouts only.",
};

/** Runtime narrowing for values arriving from query strings or forms. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
