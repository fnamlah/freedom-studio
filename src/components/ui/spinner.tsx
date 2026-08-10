import { cn } from "@/lib/utils";

export type SpinnerProps = {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Announced to screen readers. Set to `null` for purely decorative use. */
  label?: string | null;
};

const SIZES = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
} as const;

/** Indeterminate loading indicator. */
export function Spinner({ size = "md", className, label = "Loading" }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block animate-spin rounded-full border-current border-t-transparent text-primary",
          SIZES[size],
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Full-panel loading state, for `loading.tsx` route files and suspense fallbacks. */
export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-40 w-full items-center justify-center rounded-lg border border-border bg-surface">
      <Spinner size="md" label={label} />
    </div>
  );
}
