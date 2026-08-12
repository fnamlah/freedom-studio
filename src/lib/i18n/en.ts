/**
 * The English dictionary — and the SOURCE OF TRUTH for the shape of every other
 * dictionary. `ru.ts` declares `satisfies typeof en`, so a key added here and
 * not translated there is a compile error, not a screen that silently falls
 * back to English. That constraint is the only thing that keeps a translation
 * of this size honest.
 *
 * Conventions:
 *   - Nested objects by area; access is plain property access (`d.nav.library`),
 *     so TypeScript checks every reference and autocomplete works.
 *   - Anything with a runtime value is a FUNCTION, not a template with
 *     placeholders — `count: (n) => …` — because Russian pluralization cannot be
 *     expressed by string substitution (1 файл / 2 файла / 5 файлов).
 *   - Keep entries in the same order in both files; it makes diffing possible.
 *
 * Note the ABSENCE of `as const`: it would fix every value to its own literal
 * type ("Save"), and no translation could then satisfy the shape. Widened
 * `string` is what makes `ru satisfies Dictionary` check keys and signatures
 * while allowing different words.
 */

import { authFlowEn } from "./areas/auth-flow";

import { documentsEn } from "./areas/documents";
import { libraryEn } from "./areas/library";
import { studioEn } from "./areas/studio";
import { adminAiEn } from "./areas/admin-ai";

import { moneyEn } from "./areas/money";

export const en = {
  common: {
    appName: "Freedom Studio",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    confirm: "Confirm",
    back: "Back",
    next: "Next",
    previous: "Previous",
    search: "Search",
    filter: "Filter",
    clear: "Clear",
    apply: "Apply",
    download: "Download",
    upload: "Upload",
    refresh: "Refresh",
    loading: "Loading…",
    saving: "Saving…",
    none: "None",
    all: "All",
    yes: "Yes",
    no: "No",
    optional: "optional",
    required: "required",
    actions: "Actions",
    status: "Status",
    total: "Total",
    date: "Date",
    notes: "Notes",
    unknownError: "Something went wrong. Please try again.",
    tryAgain: "Try again",
    showing: (shown: number, total: number) => `${shown} of ${total}`,
  },

  locale: {
    label: "Language",
    switchTo: (name: string) => `Switch to ${name}`,
    changed: "Language changed.",
    changeFailed: "Could not change the language.",
  },

  nav: {
    dashboard: "Dashboard",
    sectionStudio: "Studio",
    models: "Models",
    operators: "Operators",
    platforms: "Platforms",
    sessions: "Work sessions",
    earnings: "Earnings",
    documents: "Documents",
    library: "Library",
    sectionMoney: "Money",
    schemes: "Commission schemes",
    ledger: "Ledger",
    payouts: "Payouts",
    statements: "Statements",
    forecasts: "Forecasts",
    sectionIntelligence: "Intelligence",
    ai: "AI assistant",
    aiReports: "AI reports",
    sectionAdmin: "Admin",
    hermes: "Hermes",
    users: "Users",
    invitations: "Invitations",
    auditLog: "Audit log",
    settings: "Settings",
  },

  shell: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    userMenu: "Account menu",
    signOut: "Sign out",
    signingOut: "Signing out…",
    mfaVerified: "2FA verified",
    rlsFooter: "Row Level Security is the final authority.",
  },

  roles: {
    super_admin: "Super Admin",
    manager: "Manager",
    model: "Model",
    finance: "Finance",
    operator: "Operator",
  },

  auth: {
    signInTitle: "Sign in",
    signInSubtitle: "Freedom Studio — internal back office.",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    invalidCredentials: "That email or password is not right.",
    setPasswordTitle: "Set your password",
    setPasswordCta: "Set password and continue",
    passwordMismatch: "The two passwords do not match.",
    mfaEnrollTitle: "Set up two-factor authentication",
    mfaEnrollIntro:
      "Two-factor authentication is mandatory. Scan the code with your authenticator app, then enter the six-digit code it shows.",
    mfaSecretLabel: "Or enter this key manually",
    mfaChallengeTitle: "Two-factor verification",
    mfaChallengeIntro: "Enter the six-digit code from your authenticator app.",
    otpLabel: "Verification code",
    verify: "Verify",
    verifyAndContinue: "Verify and continue",
    finishAndContinue: "Finish and continue",
    invalidOtp: "That code was not accepted. Try the next one.",
    forbiddenTitle: "Not available to your role",
    forbiddenBody: (roles: string) =>
      `This page is limited to: ${roles}. Row Level Security is the final authority, so a hidden page still shows you nothing.`,
    backToDashboard: "Back to the dashboard",
  },

  authFlow: authFlowEn,

  library: libraryEn,
  documents: documentsEn,
  studio: studioEn,
  adminAi: adminAiEn,
  money: moneyEn,
};

export type Dictionary = typeof en;
