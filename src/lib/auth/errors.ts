/**
 * Typed authorization failures shared by the guard and the admin client.
 */

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

  constructor(code: AuthzErrorCode, message?: string) {
    super(message ?? defaultMessage(code));
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

function defaultMessage(code: AuthzErrorCode): string {
  switch (code) {
    case "unauthenticated":
      return "Not signed in.";
    case "aal2_required":
      return "Two-factor verification is required for this action.";
    case "profile_missing":
      return "No profile is linked to this account.";
    case "profile_inactive":
      return "This account is not active.";
    case "forbidden":
      return "Your role does not permit this action.";
    case "misconfigured":
      return "Server is not configured for privileged operations.";
  }
}
