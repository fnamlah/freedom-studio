import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

export type TableProps = ComponentPropsWithRef<"table"> & {
  /** Wraps the table in a horizontal scroll container. Default: true. */
  scrollable?: boolean;
  containerClassName?: string;
};

/**
 * Data table primitives. Compose as:
 *
 * ```tsx
 * <Table>
 *   <THead><TR><TH>Model</TH><TH align="right">Net</TH></TR></THead>
 *   <TBody>
 *     {rows.map((r) => (
 *       <TR key={r.id}><TD>{r.stage_name}</TD><TD align="right" numeric>{money(r.net)}</TD></TR>
 *     ))}
 *   </TBody>
 * </Table>
 * ```
 */
export function Table({
  className,
  scrollable = true,
  containerClassName,
  ...props
}: TableProps) {
  const table = (
    <table
      className={cn("w-full border-collapse text-left text-sm", className)}
      {...props}
    />
  );

  if (!scrollable) return table;
  return (
    <div className={cn("w-full max-w-full min-w-0 overflow-x-auto", containerClassName)}>
      {table}
    </div>
  );
}

export function THead({ className, ...props }: ComponentPropsWithRef<"thead">) {
  return (
    <thead
      className={cn("border-b border-border bg-surface-2/60 text-muted", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: ComponentPropsWithRef<"tbody">) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TFoot({ className, ...props }: ComponentPropsWithRef<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t border-border bg-surface-2/40 font-medium", className)}
      {...props}
    />
  );
}

export type TRProps = ComponentPropsWithRef<"tr"> & {
  /** Adds hover feedback for rows that navigate somewhere. */
  interactive?: boolean;
};

export function TR({ className, interactive = false, ...props }: TRProps) {
  return (
    <tr
      className={cn(interactive && "cursor-pointer transition-colors hover:bg-surface-2/50", className)}
      {...props}
    />
  );
}

export type CellAlign = "left" | "center" | "right";

const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export type THProps = ComponentPropsWithRef<"th"> & { align?: CellAlign };

export function TH({ className, align = "left", scope = "col", ...props }: THProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-4 py-2.5 text-xs font-medium tracking-wide uppercase",
        ALIGN[align],
        className,
      )}
      {...props}
    />
  );
}

export type TDProps = ComponentPropsWithRef<"td"> & {
  align?: CellAlign;
  /** Tabular figures + right alignment for money and counts. */
  numeric?: boolean;
};

export function TD({ className, align, numeric = false, ...props }: TDProps) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle text-foreground",
        ALIGN[align ?? (numeric ? "right" : "left")],
        numeric && "tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentPropsWithRef<"caption">) {
  return <caption className={cn("px-4 py-2 text-left text-xs text-muted", className)} {...props} />;
}
