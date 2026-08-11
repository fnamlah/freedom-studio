import type { ComponentPropsWithRef } from "react";

import { FIELD_BASE, FIELD_INVALID } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  invalid?: boolean;
};

/** Multi-line text input. Defaults to 4 rows and vertical-only resize. */
export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, "resize-y", invalid && FIELD_INVALID, className)}
      {...props}
    />
  );
}
