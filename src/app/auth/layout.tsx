import type { ReactNode } from "react";

/**
 * Layout for the authentication surface (`/auth/*`).
 *
 * These routes live OUTSIDE the `(app)` route group on purpose: they must render
 * for anonymous and under-assured sessions and must NOT mount the AppShell
 * (sidebar/topbar), which assumes an active, AAL2 caller. The middleware
 * (src/middleware.ts) allows `/auth/*` at every assurance level.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* Subtle, non-interactive backdrop — pure CSS, no external asset. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, rgba(91,140,255,0.10), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-md">{children}</div>
    </main>
  );
}
