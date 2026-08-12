"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Pass 0 to require a manual dismiss. */
  durationMs?: number;
};

export type Toast = ToastOptions & { id: string };

export type ToastApi = {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toast provider. Mount ONCE, high in the tree — `AppShell` already does this,
 * so feature code only ever calls `useToast()`.
 */
export function ToastProvider({
  children,
  defaultDurationMs = 5000,
}: {
  children: ReactNode;
  defaultDurationMs?: number;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const duration = options.durationMs ?? defaultDurationMs;
      setToasts((current) => [...current, { ...options, id }]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [defaultDurationMs, dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: "success" }),
      error: (title, description) =>
        toast({ title, description, variant: "error", durationMs: 8000 }),
      dismiss,
      dismissAll,
    }),
    [toast, dismiss, dismissAll],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Access the toast API from any client component below `<ToastProvider>`.
 *
 * ```tsx
 * const { success, error } = useToast();
 * success("Payout approved");
 * ```
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast() must be used inside <ToastProvider>.");
  }
  return context;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  info: "border-border bg-surface-2",
  success: "border-success/40 bg-success/10",
  warning: "border-warning/40 bg-warning/10",
  error: "border-danger/40 bg-danger/10",
};

const VARIANT_ACCENT: Record<ToastVariant, string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

/** Live region that renders the stack. Exported for tests; mounted by ToastProvider. */
export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-[100] flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm"
    >
      {toasts.map((item) => {
        const variant = item.variant ?? "info";
        return (
          <div
            key={item.id}
            role="status"
            aria-live={variant === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg",
              VARIANT_STYLES[variant],
            )}
          >
            <span
              aria-hidden="true"
              className={cn("mt-0.5 text-sm leading-none", VARIANT_ACCENT[variant])}
            >
              ●
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs break-words text-muted">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-muted transition-colors hover:text-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-3.5 w-3.5"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
