import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type Breadcrumb = { label: string; href?: string };

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  /** Renders below the header — typically a `<Tabs>` bar. */
  children?: ReactNode;
  className?: string;
};

/** Standard page title block. Use once at the top of every route. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}
