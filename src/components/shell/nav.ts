import type { Role } from "@/lib/auth/roles";

/**
 * Role-aware navigation model.
 *
 * Derived from the surfaces map in docs/03-roles-rbac.md §5 and the capability
 * matrix in §3. Navigation is a UX convenience ONLY — RLS remains the boundary,
 * so a user who reaches a hidden route still reads only their permitted rows.
 *
 * Editing rule: a link may never be shown to a role the capability matrix denies.
 * Narrower than the matrix is fine; wider is a bug.
 */

export type NavIconName =
  | "dashboard"
  | "models"
  | "operators"
  | "platforms"
  | "sessions"
  | "earnings"
  | "documents"
  | "library"
  | "schemes"
  | "ledger"
  | "payouts"
  | "statements"
  | "forecasts"
  | "ai"
  | "reports"
  | "users"
  | "invitations"
  | "audit"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  /** Roles allowed to SEE this link. */
  roles: readonly Role[];
  /** Match the pathname exactly instead of by prefix (for parent routes). */
  exact?: boolean;
};

export type NavSection = {
  /** `null` renders the section without a heading. */
  title: string | null;
  items: readonly NavItem[];
};

const ALL: readonly Role[] = ["super_admin", "manager", "model", "finance", "operator"];
const SA_MGR: readonly Role[] = ["super_admin", "manager"];
const SA_MGR_FIN: readonly Role[] = ["super_admin", "manager", "finance"];
const SA_FIN: readonly Role[] = ["super_admin", "finance"];
const MONEY_AND_SELF: readonly Role[] = [
  "super_admin",
  "manager",
  "finance",
  "model",
  "operator",
];
const SA_ONLY: readonly Role[] = ["super_admin"];

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: ALL }],
  },
  {
    title: "Studio",
    items: [
      { href: "/models", label: "Models", icon: "models", roles: SA_MGR },
      { href: "/operators", label: "Operators", icon: "operators", roles: SA_MGR },
      { href: "/platforms", label: "Platforms", icon: "platforms", roles: SA_MGR },
      { href: "/sessions", label: "Work sessions", icon: "sessions", roles: SA_MGR },
      { href: "/earnings", label: "Earnings", icon: "earnings", roles: SA_MGR },
      { href: "/documents", label: "Documents", icon: "documents", roles: SA_MGR },
      { href: "/library", label: "Library", icon: "library", roles: SA_MGR },
    ],
  },
  {
    title: "Money",
    items: [
      // Schemes: Super Admin has CRUD, Manager reads (docs/03 §3).
      { href: "/schemes", label: "Commission schemes", icon: "schemes", roles: SA_MGR },
      // Own rows for model/operator; studio-wide for SA/MGR/FIN.
      { href: "/ledger", label: "Ledger", icon: "ledger", roles: MONEY_AND_SELF },
      { href: "/payouts", label: "Payouts", icon: "payouts", roles: MONEY_AND_SELF },
      { href: "/statements", label: "Statements", icon: "statements", roles: MONEY_AND_SELF },
      { href: "/forecasts", label: "Forecasts", icon: "forecasts", roles: SA_MGR_FIN },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/ai", label: "AI assistant", icon: "ai", roles: SA_MGR_FIN, exact: true },
      // Market reports are Super Admin + Finance only (docs/03 §3, "Generate /
      // read AI market reports": MGR = ❌). Do not widen without changing 03.
      { href: "/ai/reports", label: "AI reports", icon: "reports", roles: SA_FIN },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/admin/users", label: "Users", icon: "users", roles: SA_ONLY },
      { href: "/admin/invitations", label: "Invitations", icon: "invitations", roles: SA_ONLY },
      { href: "/admin/audit-log", label: "Audit log", icon: "audit", roles: SA_ONLY },
      { href: "/admin/settings", label: "Settings", icon: "settings", roles: SA_ONLY },
    ],
  },
] as const;

/** Sections filtered to the links a role may see. Empty sections are dropped. */
export function navSectionsForRole(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Flat list of visible links, for command palettes and tests. */
export function navItemsForRole(role: Role): NavItem[] {
  return navSectionsForRole(role).flatMap((section) => [...section.items]);
}

/** Active-link test: exact match, or prefix match on a path segment boundary. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
