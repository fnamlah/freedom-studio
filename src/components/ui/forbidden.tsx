"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useDict } from "@/lib/i18n/client";

export type ForbiddenViewProps = {
  title?: string;
  message?: string;
  /** Roles that would have been allowed — rendered as a hint. */
  requiredRoles?: string[];
  backHref?: string;
};

/**
 * The standard 403 surface, rendered by `forbidden()` in `@/lib/auth/guard` and
 * by the `/forbidden` route.
 *
 * Deliberately says nothing about what exists behind the wall: RLS is the real
 * boundary (docs/02 §3), and this page must not become an enumeration oracle.
 *
 * A client component so that its default copy can come from the dictionary: the
 * `@/components/ui` barrel is imported by client components, so this module can
 * never reach for `next/headers` the way a server-side `getDict()` would.
 * `title` and `message` stay overridable for callers with something specific to
 * say — `forbidden()` passes `undefined` and gets the translated defaults.
 */
export function ForbiddenView({
  title,
  message,
  requiredRoles,
  backHref = "/dashboard",
}: ForbiddenViewProps) {
  const d = useDict();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-danger"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 className="text-lg font-semibold text-foreground">{title ?? d.auth.forbiddenTitle}</h1>
        <p className="mt-2 text-sm text-muted">{message ?? d.authFlow.forbiddenMessage}</p>

        {requiredRoles && requiredRoles.length > 0 ? (
          <p className="mt-3 text-xs text-muted">
            {d.authFlow.requiredRoles(requiredRoles.length)}{" "}
            <span className="text-foreground">{requiredRoles.join(", ")}</span>
          </p>
        ) : null}

        <div className="mt-6">
          <Link href={backHref}>
            <Button variant="secondary" size="sm">
              {d.auth.backToDashboard}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
