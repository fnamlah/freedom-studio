"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { MenuIcon, ShieldIcon, SignOutIcon } from "@/components/shell/icons";
import { Badge } from "@/components/ui/badge";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import { type Role } from "@/lib/auth/roles";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { useDict } from "@/lib/i18n/client";
import { initials } from "@/lib/format";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export type TopBarProps = {
  fullName: string;
  email: string;
  role: Role;
  /** Opens the mobile nav drawer. */
  onOpenNav?: () => void;
  /** Optional right-aligned slot (search, period picker). */
  children?: ReactNode;
};

/**
 * Application top bar: mobile nav toggle, an AAL2 assurance marker, and the user
 * menu with sign-out.
 *
 * Sign-out goes through the BROWSER client (anon key only) — it clears the
 * session cookies, then a `refresh()` lets the middleware take over and redirect.
 */
export function TopBar({ fullName, email, role, onOpenNav, children }: TopBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const d = useDict();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await createBrowserSupabase().auth.signOut();
    } finally {
      setOpen(false);
      router.replace(AUTH_ROUTES.login);
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={d.shell.openMenu}
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:hidden"
      >
        <MenuIcon width={18} height={18} />
      </button>

      <div className="ml-auto flex items-center gap-3">
        {children}

        <span
          className="hidden items-center gap-1.5 text-xs text-muted sm:flex"
        >
          <ShieldIcon width={14} height={14} className="text-success" />
          {d.shell.mfaVerified}
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary",
              open ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {initials(fullName)}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm text-foreground sm:inline">
              {fullName}
            </span>
          </button>

          {open ? (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-surface p-1 shadow-xl"
            >
              <div className="border-b border-border px-3 py-2.5">
                <p className="truncate text-sm font-medium text-foreground">{fullName}</p>
                <p className="truncate text-xs text-muted">{email}</p>
                <Badge variant="primary" className="mt-2">
                  {d.roles[role]}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs text-muted">{d.locale.label}</span>
                <LocaleSwitcher />
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                disabled={signingOut}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
              >
                <SignOutIcon width={15} height={15} />
                {signingOut ? d.shell.signingOut : d.shell.signOut}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
