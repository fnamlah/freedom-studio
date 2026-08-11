import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /** Optional illustration or icon rendered above the title. */
  icon?: ReactNode;
  /** Primary call to action. */
  action?: ReactNode;
  className?: string;
  /** Renders without the border/background, for use inside an existing Card. */
  bare?: boolean;
};

/**
 * The standard "nothing here yet" surface.
 *
 * Remember that an empty table is often an RLS outcome, not a data outcome:
 * prefer neutral wording ("No earnings in this period") over "You have none".
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  bare = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        !bare && "rounded-lg border border-dashed border-border bg-surface",
        className,
      )}
    >
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <div className="max-w-md text-xs text-muted">{description}</div>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
