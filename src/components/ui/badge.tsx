import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export type BadgeProps = ComponentPropsWithRef<"span"> & {
  variant?: BadgeVariant;
  /** Renders a small leading status dot. */
  dot?: boolean;
};

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-surface-2 text-foreground border-border",
  primary: "bg-primary/15 text-primary border-primary/30",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  muted: "bg-surface-2 text-muted border-border",
};

const DOT: Record<BadgeVariant, string> = {
  neutral: "bg-foreground",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted",
};

/**
 * Status pill.
 *
 * ```tsx
 * <Badge variant="success" dot>Active</Badge>
 * ```
 */
export function Badge({
  className,
  variant = "neutral",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT[variant])} />
      ) : null}
      {children}
    </span>
  );
}
