/**
 * Typed authorization failures shared by the guard and the admin client.
 */

import { DEFAULT_LOCALE, dict, type Locale } from "@/lib/i18n";

export type AuthzErrorCode =
  /** No session at all. */
  | "unauthenticated"
  /** Session exists but is AAL1 (password only). */
  | "aal2_required"
  /** Session exists but has no `profiles` row yet. */
  | "profile_missing"
  /** Profile exists but `status <> 'active'`. */
  | "profile_inactive"
  /** Authenticated, assured and active — but the role is not permitted. */
  | "forbidden"
  /** Server misconfiguration (e.g. missing SUPABASE_SERVICE_ROLE_KEY). */
  | "misconfigured";

const STATUS_BY_CODE: Record<AuthzErrorCode, number> = {
  unauthenticated: 401,
  aal2_required: 401,
  profile_missing: 403,
  profile_inactive: 403,
  forbidden: 403,
  misconfigured: 500,
};

/**
 * Thrown by non-redirecting authorization paths (route handlers, server actions,
 * `guardedAdminClient`). Server components should prefer `requireRole()` from
 * `@/lib/auth/guard`, which redirects instead of throwing.
 */
export class AuthzError extends Error {
  readonly code: AuthzErrorCode;
  readonly status: number;

  /**
   * `message` is what the caller eventually reads (route handlers put it in the
   * JSON body, server actions toast it), so it is translated. The constructor is
   * synchronous and cannot await `getLocale()`, hence the explicit `locale`
   * argument — callers that already resolved one should pass it; everyone else
   * gets the default language, which is the studio's own.
   */
  constructor(code: AuthzErrorCode, message?: string, locale: Locale = DEFAULT_LOCALE) {
    super(message ?? defaultMessage(code, locale));
    this.name = "AuthzError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  /** Shape suitable for a JSON error response. Never leaks internals. */
  toResponseBody(): { error: string; code: AuthzErrorCode } {
    return { error: this.message, code: this.code };
  }
}

export function isAuthzError(value: unknown): value is AuthzError {
  return value instanceof AuthzError;
}

/**
 * The dictionary keys under `authFlow.errors` are the `AuthzErrorCode` values
 * themselves, so this is a plain index — and a new code without a translation is
 * a compile error rather than an empty message.
 */
export function defaultMessage(code: AuthzErrorCode, locale: Locale = DEFAULT_LOCALE): string {
  return dict(locale).authFlow.errors[code];
}
