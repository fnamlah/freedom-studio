import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

export const FIELD_BASE =
  "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted/70 outline-none transition-colors " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD_INVALID =
  "border-danger focus-visible:border-danger focus-visible:ring-danger/40";

export type InputProps = ComponentPropsWithRef<"input"> & {
  /** Marks the field invalid and wires `aria-invalid`. */
  invalid?: boolean;
};

/**
 * Text input.
 *
 * ```tsx
 * <Label htmlFor="stage-name">Stage name</Label>
 * <Input id="stage-name" name="stage_name" required />
 * ```
 */
export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, "h-9", invalid && FIELD_INVALID, className)}
      {...props}
    />
  );
}
