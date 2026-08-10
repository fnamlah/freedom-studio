import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

export type LabelProps = ComponentPropsWithRef<"label"> & {
  /** Appends a red asterisk with an accessible "required" hint. */
  required?: boolean;
  /** Small right-aligned hint, e.g. "optional" or a character counter. */
  hint?: string;
};

/** Form label. Always pair with the control's `id` via `htmlFor`. */
export function Label({ className, required, hint, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-muted",
        className,
      )}
      {...props}
    >
      <span>
        {children}
        {required ? (
          <span className="ml-0.5 text-danger" title="Required">
            *<span className="sr-only"> required</span>
          </span>
        ) : null}
      </span>
      {hint ? <span className="font-normal text-muted/70">{hint}</span> : null}
    </label>
  );
}

export type FieldProps = ComponentPropsWithRef<"div"> & {
  /** Error text rendered under the control, wired for screen readers. */
  error?: string | null;
  /** Neutral helper text rendered under the control. */
  help?: string | null;
};

/** Vertical field wrapper: label + control + help/error text. */
export function Field({ className, error, help, children, ...props }: FieldProps) {
  return (
    <div className={cn("flex flex-col", className)} {...props}>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : help ? (
        <p className="mt-1.5 text-xs text-muted">{help}</p>
      ) : null}
    </div>
  );
}
