import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardProps = ComponentPropsWithRef<"div"> & {
  /** Removes the surface background — for cards that sit on their own panel. */
  bare?: boolean;
};

/** Surface container. The default panel for every section of the app. */
export function Card({ className, bare = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        // `overflow-hidden` keeps wide children (scrollable tables) inside the
        // rounded frame and stops them inflating the mobile layout viewport.
        "min-w-0 overflow-hidden rounded-lg border border-border",
        bare ? "bg-transparent" : "bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export type CardHeaderProps = ComponentPropsWithRef<"div"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot for buttons, filters, badges. */
  action?: ReactNode;
};

/**
 * Card header. Either pass `title`/`description`/`action`, or supply arbitrary
 * `children` for a fully custom header.
 */
export function CardHeader({
  className,
  title,
  description,
  action,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-5 py-4",
        className,
      )}
      {...props}
    >
      {children ?? (
        <div className="min-w-0">
          {title ? (
            <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          ) : null}
          {description ? (
            <p className="mt-1 text-xs text-muted">{description}</p>
          ) : null}
        </div>
      )}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export type CardBodyProps = ComponentPropsWithRef<"div"> & {
  /** Drops the default padding — for tables that should touch the card edges. */
  flush?: boolean;
};

export function CardBody({ className, flush = false, ...props }: CardBodyProps) {
  return <div className={cn(flush ? "p-0" : "p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentPropsWithRef<"h3">) {
  return <h3 className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithRef<"p">) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}
