"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { CloseIcon } from "@/components/shell/icons";
import { SideNav } from "@/components/shell/side-nav";
import { TopBar } from "@/components/shell/top-bar";
import { ToastProvider } from "@/components/ui/toast";
import type { Role } from "@/lib/auth/roles";
import { useDict } from "@/lib/i18n/client";

export type AppShellProps = {
  /** Display name of the signed-in user. */
  fullName: string;
  email: string;
  role: Role;
  children: ReactNode;
};

/**
 * Authenticated application chrome: fixed sidebar on large screens, a slide-over
 * drawer on small ones, the top bar, and the toast provider.
 *
 * Mounted by `src/app/(app)/layout.tsx` AFTER `requireUser()` has verified the
 * session, so it only ever renders for an active, AAL2 caller. It receives
 * scalar props rather than the whole `profiles` row — nothing beyond name, email
 * and role is serialized into the client payload.
 */
export function AppShell({ fullName, email, role, children }: AppShellProps) {
  const d = useDict();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
          <BrandMark />
          <div className="flex-1 overflow-y-auto">
            <SideNav role={role} />
          </div>
          <p className="px-5 py-3 text-[11px] text-muted/70">
            {d.shell.rlsFooter}
          </p>
        </aside>

        {/* Mobile drawer */}
        {navOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setNavOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border pr-2">
                <BrandMark />
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label={d.shell.closeMenu}
                  className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <CloseIcon width={18} height={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SideNav role={role} onNavigate={() => setNavOpen(false)} />
              </div>
            </aside>
          </div>
        ) : null}

        <div className="lg:pl-60">
          <TopBar
            fullName={fullName}
            email={email}
            role={role}
            onOpenNav={() => setNavOpen(true)}
          />
          <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

function BrandMark() {
  return (
    <Link
      href="/dashboard"
      className="flex h-14 items-center gap-2.5 border-b border-border px-5 outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
        FS
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Freedom Studio
      </span>
    </Link>
  );
}
