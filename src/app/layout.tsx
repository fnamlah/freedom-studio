import type { Metadata, Viewport } from "next";

import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Freedom Studio",
    template: "%s · Freedom Studio",
  },
  description: "Back-office management for studio operations.",
  // Nothing in this application should ever be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

/**
 * The locale is resolved once here and flows two ways: into `<html lang>` (so
 * screen readers, hyphenation and the browser's own translate prompt agree with
 * the content) and into the client provider, so every client component reads the
 * same value the server rendered with. Both auth pages and the app sit under
 * this layout, which is why the provider lives here rather than in `(app)/`.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale} data-theme="dark">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
