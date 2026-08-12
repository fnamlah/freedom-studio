"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { useDict } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Rendered in the footer, right-aligned. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Disables closing via backdrop click and Escape — for destructive confirmations. */
  dismissible?: boolean;
  className?: string;
};

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

/**
 * Modal dialog built on the native `<dialog>` element, so focus trapping, the
 * top layer and inertness of the page behind come from the platform rather than
 * from hand-rolled JavaScript.
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <Dialog open={open} onClose={() => setOpen(false)} title="Revoke share link"
 *   footer={<Button variant="danger" onClick={revoke}>Revoke</Button>}>
 *   This link stops working immediately.
 * </Dialog>
 * ```
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
}: DialogProps) {
  const d = useDict();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (dismissible) onClose();
    };
    const handleClose = () => {
      if (open) onClose();
    };

    node.addEventListener("cancel", handleCancel);
    node.addEventListener("close", handleClose);
    return () => {
      node.removeEventListener("cancel", handleCancel);
      node.removeEventListener("close", handleClose);
    };
  }, [open, dismissible, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? "dialog-title" : undefined}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-0 text-foreground",
        "backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        SIZES[size],
        className,
      )}
      onClick={(event) => {
        // Clicks land on the <dialog> itself only when they hit the backdrop.
        if (dismissible && event.target === ref.current) onClose();
      }}
    >
      {title || description ? (
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 id="dialog-title" className="text-sm font-semibold text-foreground">
                {title}
              </h2>
            ) : null}
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={d.common.close}
              className="-mr-1 -mt-1 rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-4 w-4"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="px-5 py-4 text-sm">{children}</div>

      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
