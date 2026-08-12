"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ICONS } from "@/components/shell/icons";
import { isNavItemActive, navSectionsForRole } from "@/components/shell/nav";
import type { Role } from "@/lib/auth/roles";
import { useDict } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type SideNavProps = {
  role: Role;
  /** Called after a link is clicked — closes the drawer on mobile. */
  onNavigate?: () => void;
  className?: string;
};

/**
 * Role-aware sidebar navigation (docs/03-roles-rbac.md §5).
 *
 * Hiding a link is UX, not security: every destination re-checks the caller with
 * `requireRole()`, and RLS bounds what the page can read regardless.
 */
export function SideNav({ role, onNavigate, className }: SideNavProps) {
  const pathname = usePathname() ?? "";
  const sections = navSectionsForRole(role);
  const d = useDict();

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-6 px-3 py-4", className)}>
      {sections.map((section, index) => (
        <div key={section.title ?? `section-${index}`}>
          {section.title ? (
            <p className="mb-1.5 px-2 text-[11px] font-medium tracking-wider text-muted/70 uppercase">
              {d.nav[section.title]}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              const IconComponent = NAV_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      "outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      active
                        ? "bg-surface-2 font-medium text-foreground"
                        : "text-muted hover:bg-surface-2/60 hover:text-foreground",
                    )}
                  >
                    <span className={cn("shrink-0", active ? "text-primary" : "text-muted")}>
                      <IconComponent />
                    </span>
                    <span className="truncate">{d.nav[item.label]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
