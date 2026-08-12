import { plural } from "../locales";

/**
 * The authentication surface — everything under `/auth/*`, the 403 page, and the
 * typed authorization failures shared by the guard and the admin client.
 *
 * The short, reusable auth vocabulary (sign in, password, the MFA titles, the
 * OTP label, the forbidden heading) already lives in the top-level `auth` and
 * `roles` sections of `../en.ts`; this area holds only what those do not cover —
 * the flow-specific copy of docs/05-auth-2fa.md Flows A and B, the validation
 * messages, and the role descriptions shown when a role is assigned.
 *
 * These strings are read at three different moments, which is why they cannot
 * all come from one place: before a session exists (login, invite acceptance —
 * locale from the `NEXT_LOCALE` cookie), during a half-assured session (MFA), and
 * from `AuthzError`, which is constructed synchronously and therefore falls back
 * to the default locale unless a caller passes one.
 */

export const authFlowEn = {
  // --- Sign in (Flow B) ---------------------------------------------------
  signInDescription: "Access is invite-only. Sign in with the email your administrator invited.",
  emailRequired: "Enter your email.",
  emailInvalid: "Enter a valid email address.",
  passwordRequired: "Enter your password.",
  checkDetails: "Check your details and try again.",
  /** `?error=no_profile` — invited, but the invitation was never completed. */
  errorNoProfile:
    "Your account isn't fully set up yet. Contact your administrator to complete the invitation.",
  /** `?error=inactive` — the profile exists but was deactivated. */
  errorInactive:
    "This account has been deactivated. Contact your administrator if you believe this is a mistake.",

  // --- Invite acceptance (Flow A) ----------------------------------------
  preparingInvite: "Preparing your invitation",
  verifyingInviteLink: "Verifying your invite link…",
  inviteInvalidTitle: "Invite link is invalid or expired",
  inviteInvalidBody:
    "This invitation link could not be verified. Invite links are single-use and expire after 7 days.",
  inviteAskAdmin: "Ask your administrator to send a fresh invitation, then open the new link.",
  goToSignIn: "Go to sign in",
  setPasswordForEmail: (email: string) =>
    `Choose a password for ${email}. You'll set up two-factor authentication next.`,
  setPasswordNoEmail: "Choose a password. You'll set up two-factor authentication next.",
  newPassword: "New password",
  passwordTooShort: (n: number) => `Use at least ${n} characters.`,
  passwordMinHelp: (n: number) => `At least ${n} characters.`,

  // --- TOTP challenge (Flow B tail) --------------------------------------
  signInAsDifferentUser: "Sign in as a different user",

  // --- TOTP enrollment (Flow A tail) -------------------------------------
  preparingAuthenticator: "Preparing your authenticator…",
  enrollStartFailed: "Could not start enrollment.",
  enrollNotStarted: "Enrollment has not started yet. Reload the page and try again.",
  authenticatorVerified:
    "Your authenticator is verified. Finish setting up your account to continue.",
  activationFailed: (reason: string) => `Almost there — activating your account failed: ${reason}`,
  qrAlt: "QR code for two-factor authentication setup",
  otpAriaLabel: "6-digit authentication code",

  /** Results of `activateProfileAfterEnrollment` that are not `errors.*` below. */
  activate: {
    noVerifiedFactor: "No verified authenticator was found on this account.",
    cannotActivate: "This account cannot be activated.",
  },

  // --- The 403 surface ----------------------------------------------------
  forbiddenMetaTitle: "Not available",
  forbiddenMessage:
    "Your account does not have access to this area. If you believe this is a mistake, contact the studio owner.",
  /**
   * Label only — the role names themselves are data and are appended by the
   * view. The explicit `: string` return keeps TypeScript from inferring the
   * literal union, which no translation could then satisfy.
   */
  requiredRoles: (n: number): string => (n > 1 ? "Required roles:" : "Required role:"),

  /**
   * `AuthzError.defaultMessage()`. Keyed by `AuthzErrorCode` so the lookup is a
   * plain index and a new code is a compile error here, not a blank message.
   */
  errors: {
    unauthenticated: "Not signed in.",
    aal2_required: "Two-factor verification is required for this action.",
    profile_missing: "No profile is linked to this account.",
    profile_inactive: "This account is not active.",
    forbidden: "Your role does not permit this action.",
    misconfigured: "Server is not configured for privileged operations.",
  },

  /** Shown on the admin surfaces that assign a role (docs/03-roles-rbac.md §1). */
  roleDescriptions: {
    super_admin: "Studio owner. Full control; sole payout approver and audit-log reader.",
    manager: "Day-to-day operations. No user administration, no financial authorization.",
    model: "Self-service access to their own records, earnings and documents.",
    finance: "Money only. No access to identity or compliance documents.",
    operator: "Self-service support staff. Sees their own ledger share and payouts only.",
  },
};

export const authFlowRu: typeof authFlowEn = {
  // --- Вход (сценарий B) --------------------------------------------------
  signInDescription:
    "Доступ только по приглашению. Войдите с почтой, на которую администратор прислал приглашение.",
  emailRequired: "Введите email.",
  emailInvalid: "Введите корректный адрес email.",
  passwordRequired: "Введите пароль.",
  checkDetails: "Проверьте данные и попробуйте ещё раз.",
  errorNoProfile:
    "Учётная запись ещё не настроена до конца. Обратитесь к администратору, чтобы завершить приглашение.",
  errorInactive:
    "Учётная запись отключена. Если это ошибка, обратитесь к администратору.",

  // --- Приём приглашения (сценарий A) ------------------------------------
  preparingInvite: "Подготовка приглашения",
  verifyingInviteLink: "Проверяем ссылку-приглашение…",
  inviteInvalidTitle: "Ссылка-приглашение недействительна или истекла",
  inviteInvalidBody:
    "Проверить эту ссылку-приглашение не удалось. Ссылки одноразовые и действуют 7 дней.",
  inviteAskAdmin: "Попросите администратора прислать новое приглашение и откройте новую ссылку.",
  goToSignIn: "Перейти ко входу",
  setPasswordForEmail: (email: string) =>
    `Придумайте пароль для ${email}. Следующий шаг — настройка двухфакторной аутентификации.`,
  setPasswordNoEmail:
    "Придумайте пароль. Следующий шаг — настройка двухфакторной аутентификации.",
  newPassword: "Новый пароль",
  passwordTooShort: (n: number) =>
    `Используйте не менее ${n} ${plural("ru", n, {
      one: "символа",
      few: "символов",
      many: "символов",
    })}.`,
  passwordMinHelp: (n: number) =>
    `Минимум ${n} ${plural("ru", n, { one: "символ", few: "символа", many: "символов" })}.`,

  // --- Подтверждение TOTP (хвост сценария B) -----------------------------
  signInAsDifferentUser: "Войти под другим пользователем",

  // --- Настройка TOTP (хвост сценария A) ---------------------------------
  preparingAuthenticator: "Готовим аутентификатор…",
  enrollStartFailed: "Не удалось начать настройку.",
  enrollNotStarted: "Настройка ещё не началась. Обновите страницу и попробуйте ещё раз.",
  authenticatorVerified:
    "Аутентификатор подтверждён. Завершите настройку учётной записи, чтобы продолжить.",
  activationFailed: (reason: string) =>
    `Почти готово — активировать учётную запись не удалось: ${reason}`,
  qrAlt: "QR-код для настройки двухфакторной аутентификации",
  otpAriaLabel: "Шестизначный код подтверждения",

  activate: {
    noVerifiedFactor: "На этой учётной записи не найден подтверждённый аутентификатор.",
    cannotActivate: "Эту учётную запись нельзя активировать.",
  },

  // --- Экран 403 ----------------------------------------------------------
  forbiddenMetaTitle: "Недоступно",
  forbiddenMessage:
    "У вашей учётной записи нет доступа к этому разделу. Если это ошибка, обратитесь к владельцу студии.",
  requiredRoles: (n: number) =>
    plural("ru", n, {
      one: "Требуемая роль:",
      few: "Требуемые роли:",
      many: "Требуемые роли:",
    }),

  errors: {
    unauthenticated: "Вы не вошли в систему.",
    aal2_required: "Для этого действия требуется двухфакторное подтверждение.",
    profile_missing: "К этой учётной записи не привязан профиль.",
    profile_inactive: "Учётная запись неактивна.",
    forbidden: "Ваша роль не позволяет выполнить это действие.",
    misconfigured: "Сервер не настроен для привилегированных операций.",
  },

  roleDescriptions: {
    super_admin:
      "Владелец студии. Полный контроль; единственный, кто утверждает выплаты и читает журнал действий.",
    manager:
      "Ежедневные операции. Без администрирования пользователей и без финансовых подтверждений.",
    model: "Самостоятельный доступ к своим записям, доходам и документам.",
    finance: "Только финансы. Без доступа к документам, удостоверяющим личность, и комплаенсу.",
    operator:
      "Вспомогательный персонал. Видит только свою долю в реестре операций и свои выплаты.",
  },
};
