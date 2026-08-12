"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { AuthCard, AuthError } from "@/components/auth/auth-card";
import { Button, Field, Input, Label, Spinner } from "@/components/ui";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import type { Dictionary } from "@/lib/i18n";
import { useDict } from "@/lib/i18n/client";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Password policy for invite acceptance. Kept intentionally simple (length only)
 * and aligned with the Supabase project's own minimum — see follow-ups: the two
 * must not drift, or `updateUser` will reject a password this form accepted.
 */
const MIN_PASSWORD_LENGTH = 10;

/** A factory, so the validation messages are in the reader's language. */
const makeSchema = (d: Dictionary) =>
  z
    .object({
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, d.authFlow.passwordTooShort(MIN_PASSWORD_LENGTH)),
      confirm: z.string(),
    })
    .refine((value) => value.password === value.confirm, {
      path: ["confirm"],
      message: d.auth.passwordMismatch,
    });

type Phase = "checking" | "no_session" | "ready";

export function AcceptForm() {
  const router = useRouter();
  const d = useDict();
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  // On mount: establish the invite session, then confirm we actually have one.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const supabase = createBrowserSupabase();
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));

      // GoTrue reports verify failures in the URL FRAGMENT (implicit-style
      // transport), not the query string — check both.
      const errorDescription =
        url.searchParams.get("error_description") ?? hashParams.get("error_description");
      if (errorDescription) {
        setError(errorDescription);
        setPhase("no_session");
        return;
      }

      // Invite links redirect here with implicit-style hash tokens. The browser
      // client is configured for the PKCE flow (@supabase/ssr hardcodes it), and
      // auth-js REFUSES to auto-ingest an implicit callback on a PKCE client —
      // so the session must be established explicitly, then the tokens scrubbed
      // from the URL so they never linger in history.
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!sessionError) {
          window.history.replaceState(null, "", url.pathname + url.search);
        }
      }

      // Code-exchange fallback for the PKCE link flow.
      const code = url.searchParams.get("code");
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch {
          // Ignore — a session may already have been established from the hash.
        }
      }

      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setEmail(data.user.email ?? null);
        setPhase("ready");
      } else {
        setPhase("no_session");
      }
    })();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError({});

    const parsed = makeSchema(d).safeParse({ password, confirm });
    if (!parsed.success) {
      const next: { password?: string; confirm?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "password" || key === "confirm") next[key] = issue.message;
      }
      setFieldError(next);
      return;
    }

    setPending(true);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (updateError) {
      setError(updateError.message);
      setPending(false);
      return;
    }

    // Password set → forced TOTP enrollment (Flow A). Keep the button busy
    // through the navigation.
    router.replace(AUTH_ROUTES.mfaEnroll);
  }

  if (phase === "checking") {
    return (
      <AuthCard title={d.authFlow.preparingInvite}>
        <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted">
          <Spinner /> {d.authFlow.verifyingInviteLink}
        </div>
      </AuthCard>
    );
  }

  if (phase === "no_session") {
    return (
      <AuthCard
        title={d.authFlow.inviteInvalidTitle}
        description={d.authFlow.inviteInvalidBody}
        footer={
          <a className="text-primary hover:underline" href={AUTH_ROUTES.login}>
            {d.authFlow.goToSignIn}
          </a>
        }
      >
        {error ? <AuthError>{error}</AuthError> : null}
        <p className="text-sm text-muted">{d.authFlow.inviteAskAdmin}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={d.auth.setPasswordTitle}
      description={
        email ? d.authFlow.setPasswordForEmail(email) : d.authFlow.setPasswordNoEmail
      }
    >
      {error ? <AuthError>{error}</AuthError> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field error={fieldError.password}>
          <Label htmlFor="password" required>
            {d.authFlow.newPassword}
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            invalid={Boolean(fieldError.password)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </Field>

        <Field
          error={fieldError.confirm}
          help={
            fieldError.confirm ? undefined : d.authFlow.passwordMinHelp(MIN_PASSWORD_LENGTH)
          }
        >
          <Label htmlFor="confirm" required>
            {d.auth.confirmPassword}
          </Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(fieldError.confirm)}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={pending}
          />
        </Field>

        <Button type="submit" fullWidth loading={pending}>
          {d.auth.setPasswordCta}
        </Button>
      </form>
    </AuthCard>
  );
}
