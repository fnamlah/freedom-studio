import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for every page under `/auth/*` (docs/05-auth-2fa.md flows A & B).
 *
 * Server-safe (no `"use client"`, no server-only imports) so it can be rendered
 * from either a server page or a client form. The interactive form fields are
 * passed in as `children`.
 */
export type AuthCardProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Muted, centred slot beneath the card body (help text, secondary links). */
  footer?: ReactNode;
  className?: string;
};

/** Small, dependency-free brand mark — no external asset, CSP-safe. */
function BrandMark() {
  return (
    <div className="mb-6 flex items-center justify-center gap-2.5">
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 2 4 5v6c0 4.5 3.2 8.5 8 10 4.8-1.5 8-5.5 8-10V5l-8-3Z" strokeLinejoin="round" />
          <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">Freedom Studio</span>
    </div>
  );
}

export function AuthCard({ title, description, children, footer, className }: AuthCardProps) {
  return (
    <div className={cn("w-full max-w-md", className)}>
      <BrandMark />
      <Card className="overflow-hidden">
        <div className="border-b border-border px-6 py-5">
          <h1 className="text-base font-semibold text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        <div className="px-6 py-6">{children}</div>
      </Card>
      {footer ? (
        <div className="mt-4 text-center text-xs text-muted">{footer}</div>
      ) : null}
    </div>
  );
}

/**
 * Standard error banner for the auth forms. Rendered above the fields so the
 * failure is announced (role="alert") before the user re-submits.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {children}
    </div>
  );
}

/** Non-error informational banner (e.g. "check your authenticator app"). */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
      {children}
    </div>
  );
}
