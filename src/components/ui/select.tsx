import type { ComponentPropsWithRef } from "react";

import { FIELD_BASE, FIELD_INVALID } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  /** Declarative option list. Ignored when `children` is provided. */
  options?: readonly SelectOption[];
  /** Renders a disabled, empty first option, e.g. "Select a model…". */
  placeholder?: string;
  invalid?: boolean;
  children?: React.ReactNode;
};

/**
 * Native `<select>` — deliberately not a custom listbox, so keyboard, screen
 * reader and mobile behaviour come for free.
 *
 * ```tsx
 * <Select
 *   name="status"
 *   placeholder="Any status"
 *   options={[{ value: "active", label: "Active" }]}
 * />
 * ```
 */
export function Select({
  className,
  options,
  placeholder,
  invalid,
  children,
  ...props
}: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        FIELD_BASE,
        "h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239aa4b2%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E')]",
        invalid && FIELD_INVALID,
        className,
      )}
      {...props}
    >
      {placeholder ? (
        <option value="" disabled={props.required}>
          {placeholder}
        </option>
      ) : null}
      {children ??
        options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
    </select>
  );
}
