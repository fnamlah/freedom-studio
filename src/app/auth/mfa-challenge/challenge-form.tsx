"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthCard, AuthError } from "@/components/auth/auth-card";
import { OtpInput } from "@/components/auth/otp-input";
import { isCompleteOtp } from "@/components/auth/otp";
import { Button, Field, Label, Spinner } from "@/components/ui";
import { AUTH_ROUTES } from "@/lib/auth/routes";
import { challengeAndVerifyTotp, getVerifiedTotpFactor } from "@/lib/auth/mfa";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Phase = "loading" | "ready";

/**
 * Challenges the caller's verified TOTP factor (docs/05 Flow B). If no verified
 * factor is found (e.g. an admin reset the factor), routes to forced enrollment
 * — the same tail as Flow A.
 */
export function ChallengeForm({ next }: { next: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const supabase = createBrowserSupabase();
      const factor = await getVerifiedTotpFactor(supabase);
      if (!factor) {
        router.replace(`${AUTH_ROUTES.mfaEnroll}?next=${encodeURIComponent(next)}`);
        return;
      }
      setFactorId(factor.id);
      setPhase("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!factorId) return;
    if (!isCompleteOtp(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      await challengeAndVerifyTotp(supabase, factorId, code);
    } catch {
      setError("That code didn't match. Check your authenticator app and try again.");
      setPending(false);
      return;
    }

    // Session upgraded to AAL2 — return to the originally requested route.
    router.replace(next);
  }

  async function onSignOut() {
    setPending(true);
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.replace(AUTH_ROUTES.login);
  }

  if (phase === "loading") {
    return (
      <AuthCard title="Two-factor verification">
        <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted">
          <Spinner /> Loading…
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Two-factor verification"
      description="Enter the current 6-digit code from your authenticator app to finish signing in."
      footer={
        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={pending}
          className="text-primary hover:underline disabled:opacity-50"
        >
          Sign in as a different user
        </button>
      }
    >
      {error ? <AuthError>{error}</AuthError> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field>
          <Label htmlFor="otp" required>
            Verification code
          </Label>
          <OtpInput
            id="otp"
            value={code}
            onChange={setCode}
            disabled={pending}
            invalid={Boolean(error)}
            autoFocus
          />
        </Field>

        <Button type="submit" fullWidth loading={pending} disabled={!isCompleteOtp(code)}>
          Verify
        </Button>
      </form>
    </AuthCard>
  );
}
