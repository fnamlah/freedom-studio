"use client";

import { Input } from "@/components/ui";
import { normalizeOtp, OTP_LENGTH } from "@/components/auth/otp";

/**
 * Controlled 6-digit TOTP input. Digits-only, wired for browser/one-time-code
 * autofill. Shared by the MFA enrollment and challenge forms.
 */
export type OtpInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Fires when a complete code is entered via paste/typing (e.g. auto-submit). */
  onComplete?: (value: string) => void;
};

export function OtpInput({
  id,
  value,
  onChange,
  disabled,
  autoFocus,
  invalid,
  onComplete,
}: OtpInputProps) {
  return (
    <Input
      id={id}
      name="otp"
      value={value}
      onChange={(event) => {
        const next = normalizeOtp(event.target.value);
        onChange(next);
        if (next.length === OTP_LENGTH) onComplete?.(next);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d*"
      maxLength={OTP_LENGTH}
      disabled={disabled}
      autoFocus={autoFocus}
      invalid={invalid}
      placeholder="000000"
      aria-label="6-digit authentication code"
      className="text-center text-lg tracking-[0.5em] font-mono"
    />
  );
}
