"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthCard, AuthError, AuthNotice } from "@/components/auth/auth-card";
import { OtpInput } from "@/components/auth/otp-input";
import { isCompleteOtp } from "@/components/auth/otp";
import { Button, Field, Label, Spinner } from "@/components/ui";
import { challengeAndVerifyTotp, enrollTotp, type TotpEnrollment } from "@/lib/auth/mfa";
import { useDict } from "@/lib/i18n/client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { activateProfileAfterEnrollment } from "./actions";

/** Normalises Supabase's `qr_code` into something a CSP-safe `<img>` can render. */
function qrImageSrc(qrCode: string): string {
  const trimmed = qrCode.trim();
  // Raw SVG markup → inline data URL (avoids dangerouslySetInnerHTML). Data URLs
  // are permitted by `img-src 'self' blob: data:` (docs/08 §4.1).
  if (trimmed.startsWith("<svg")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`;
  }
  return qrCode; // Already a data URL / valid src (Supabase's usual shape).
}

type Phase = "loading" | "ready" | "activating";

/**
 * Enrollment UI (docs/05 Flow A): show the provisioning QR + secret, verify a
 * 6-digit code (upgrades the session to AAL2), then activate the profile.
 */
export function EnrollForm({ next }: { next: string }) {
  const router = useRouter();
  const d = useDict();
  const [phase, setPhase] = useState<Phase>("loading");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** True once the code is verified (AAL2 reached) — the code must not be reused. */
  const [verified, setVerified] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void beginEnrollment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginEnrollment() {
    setStartError(null);
    setPhase("loading");
    try {
      const supabase = createBrowserSupabase();
      const result = await enrollTotp(supabase);
      setEnrollment(result);
      setPhase("ready");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : d.authFlow.enrollStartFailed);
      setPhase("ready");
    }
  }

  /** Flip the profile invited→active after AAL2 is reached. Retryable. */
  async function finishActivation() {
    setPending(true);
    setError(null);
    setPhase("activating");
    const result = await activateProfileAfterEnrollment();
    if (result.ok) {
      router.replace(next); // Keep the button busy through the navigation.
      return;
    }
    setError(d.authFlow.activationFailed(result.error));
    setPending(false);
    setPhase("ready");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!enrollment) {
      setError(d.authFlow.enrollNotStarted);
      return;
    }
    if (!isCompleteOtp(code)) {
      setError(d.auth.mfaChallengeIntro);
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      await challengeAndVerifyTotp(supabase, enrollment.factorId, code);
    } catch {
      setError(d.auth.invalidOtp);
      setPending(false);
      return;
    }

    // Verified → session is now AAL2. The TOTP code is single-use, so from here
    // on retries go straight to activation, never back through verification.
    setVerified(true);
    await finishActivation();
  }

  return (
    <AuthCard title={d.auth.mfaEnrollTitle} description={d.auth.mfaEnrollIntro}>
      {startError ? (
        <>
          <AuthError>{startError}</AuthError>
          <Button variant="secondary" fullWidth onClick={() => void beginEnrollment()}>
            {d.common.tryAgain}
          </Button>
        </>
      ) : phase === "loading" || !enrollment ? (
        <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted">
          <Spinner /> {d.authFlow.preparingAuthenticator}
        </div>
      ) : verified ? (
        // Code already verified (AAL2 reached) but activation didn't complete.
        // Never ask for the now-consumed code again — retry activation only.
        <>
          {error ? <AuthError>{error}</AuthError> : null}
          <AuthNotice>{d.authFlow.authenticatorVerified}</AuthNotice>
          <Button
            fullWidth
            loading={pending}
            onClick={() => void finishActivation()}
          >
            {d.auth.finishAndContinue}
          </Button>
        </>
      ) : (
        <>
          {error ? <AuthError>{error}</AuthError> : null}

          <div className="mb-5 flex flex-col items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageSrc(enrollment.qrCode)}
              alt={d.authFlow.qrAlt}
              width={180}
              height={180}
              className="rounded-md border border-border bg-white p-2"
            />
            <div className="w-full">
              <p className="mb-1 text-center text-xs text-muted">{d.auth.mfaSecretLabel}</p>
              <code className="block w-full break-all rounded-md border border-border bg-surface-2 px-3 py-2 text-center font-mono text-xs text-foreground">
                {enrollment.secret}
              </code>
            </div>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field>
              <Label htmlFor="otp" required>
                {d.auth.otpLabel}
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
              {d.auth.verifyAndContinue}
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}
