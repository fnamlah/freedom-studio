"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { AuthCard, AuthError } from "@/components/auth/auth-card";
import { Button, Field, Input, Label } from "@/components/ui";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import { getAssurance } from "@/lib/auth/mfa";
import type { Dictionary } from "@/lib/i18n";
import { useDict } from "@/lib/i18n/client";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * A factory, not a constant: a module-scope schema is evaluated at import time,
 * before any locale is known, and would freeze its messages in one language.
 */
const makeSchema = (d: Dictionary) =>
  z.object({
    email: z.string().trim().min(1, d.authFlow.emailRequired).email(d.authFlow.emailInvalid),
    password: z.string().min(1, d.authFlow.passwordRequired),
  });

/**
 * Password sign-in, then assurance-based routing (docs/05 §4):
 *   already AAL2       → the requested app route
 *   verified factor    → /auth/mfa-challenge (TOTP)
 *   no factor enrolled → /auth/mfa-enroll (forced enrollment, Flow A tail)
 *
 * The database is the real security boundary (restrictive AAL2 RLS policy); this
 * routing is UX only. `next` arrives pre-sanitised from the server page.
 */
export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const router = useRouter();
  const d = useDict();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = makeSchema(d).safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? d.authFlow.checkDetails);
      return;
    }

    setPending(true);
    const supabase = createBrowserSupabase();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (signInError) {
      // Deliberately generic — never reveal whether the email exists.
      setError(d.auth.invalidCredentials);
      setPending(false);
      return;
    }

    const assurance = await getAssurance(supabase);
    if (assurance.isAal2) {
      router.replace(next);
      return;
    }
    if (assurance.needsChallenge) {
      router.replace(`${AUTH_ROUTES.mfaChallenge}?next=${encodeURIComponent(next)}`);
      return;
    }
    router.replace(`${AUTH_ROUTES.mfaEnroll}?next=${encodeURIComponent(next)}`);
    // Keep `pending` true through the client navigation so the button stays busy.
  }

  return (
    <AuthCard title={d.auth.signInTitle} description={d.authFlow.signInDescription}>
      {error ? <AuthError>{error}</AuthError> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field>
          <Label htmlFor="email" required>
            {d.auth.email}
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </Field>

        <Field>
          <Label htmlFor="password" required>
            {d.auth.password}
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </Field>

        <Button type="submit" fullWidth loading={pending}>
          {pending ? d.auth.signingIn : d.auth.signIn}
        </Button>
      </form>
    </AuthCard>
  );
}
