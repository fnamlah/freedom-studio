/**
 * Naming for everything the suite writes into the LIVE database.
 *
 * Auth identities are FIXED across runs (bounded auth.users growth; re-runs
 * reuse them). Business entities carry the `E2E-` prefix so every permanent
 * row — audit_log and ledger_entries are append-only by design — is trivially
 * attributable to testing.
 */

export const ROLES = ["super_admin", "manager", "finance", "model", "operator"] as const;
export type E2ERole = (typeof ROLES)[number];

const ROLE_SLUG: Record<E2ERole, string> = {
  super_admin: "sa",
  manager: "mgr",
  finance: "fin",
  model: "model",
  operator: "op",
};

export function e2eEmail(role: E2ERole): string {
  return `e2e-${ROLE_SLUG[role]}@freedomstudio.test`;
}

/** Business-entity label, greppable in perpetuity. */
export function e2eName(kind: string): string {
  return `E2E-${kind}`;
}

export const E2E_PREFIX = "E2E-";
