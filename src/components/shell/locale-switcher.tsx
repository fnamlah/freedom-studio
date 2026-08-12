"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { setLocale } from "@/lib/i18n/actions";
import { useDict, useLocale } from "@/lib/i18n/client";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * EN / RU switch.
 *
 * Each language is labelled in itself (Русский, English) — someone who cannot
 * read the current interface language must still be able to find their own.
 * `router.refresh()` after the action re-renders the server tree with the new
 * locale; nothing here holds translated state of its own.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const active = useLocale();
  const d = useDict();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === active || pending) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="group"
      aria-label={d.locale.label}
    >
      {LOCALES.map((locale) => {
        const current = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => choose(locale)}
            disabled={pending}
            aria-current={current ? "true" : undefined}
            aria-label={d.locale.switchTo(LOCALE_NAMES[locale])}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium uppercase transition-colors",
              "disabled:opacity-50",
              current
                ? "bg-surface-2 text-foreground"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
