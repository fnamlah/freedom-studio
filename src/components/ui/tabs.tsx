"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(`<${component}> must be rendered inside <Tabs>.`);
  }
  return context;
}

export type TabsProps = {
  /** Controlled value. Omit for uncontrolled behaviour. */
  value?: string;
  /** Initial value when uncontrolled. Defaults to the first trigger's value. */
  defaultValue: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
};

/**
 * Accessible tab set (roving `aria-selected`, arrow-key navigation).
 *
 * ```tsx
 * <Tabs defaultValue="overview">
 *   <TabsList>
 *     <TabsTrigger value="overview">Overview</TabsTrigger>
 *     <TabsTrigger value="documents">Documents</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="overview">…</TabsContent>
 *   <TabsContent value="documents">…</TabsContent>
 * </Tabs>
 * ```
 */
export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const baseId = useId();
  const value = controlled ?? uncontrolled;

  const setValue = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div className={cn("flex flex-col gap-4", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
        );
        const index = tabs.findIndex((tab) => tab === document.activeElement);
        if (index === -1) return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        tabs[(index + delta + tabs.length) % tabs.length]?.focus();
      }}
      className={cn("flex items-center gap-1 border-b border-border", className)}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
  badge,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  const { value: active, setValue, baseId } = useTabs("TabsTrigger");
  const selected = active === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-controls={`${baseId}-panel-${value}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
        selected
          ? "border-primary text-foreground"
          : "border-transparent text-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
      {badge}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
  /** Keep the panel mounted while hidden (preserves form state). */
  keepMounted = false,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  keepMounted?: boolean;
}) {
  const { value: active, baseId } = useTabs("TabsContent");
  const selected = active === value;

  if (!selected && !keepMounted) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      hidden={!selected}
      tabIndex={0}
      className={cn("outline-none", className)}
    >
      {children}
    </div>
  );
}
