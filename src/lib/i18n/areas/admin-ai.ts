import { plural } from "../locales";

/**
 * Administration + AI surfaces.
 *
 * Covers `/admin/{users,invitations,audit-log,settings,hermes}` and the two AI
 * surfaces (`/ai`, `/ai/reports`) together with the strings their server
 * actions, the `/api/ai/chat` gateway and the budget guard return.
 *
 * Two deliberate omissions:
 *   - Provider labels ("Kimi K3 · Moonshot") stay in their modules — they are
 *     product names, which rule 10 keeps untranslated.
 *   - The AI SYSTEM PROMPTS are not here. They are model-facing instructions,
 *     not interface copy, and each lives with the module that owns it as a
 *     `…For(locale)` function (agent.ts, classify.ts, analyse-document.ts,
 *     reports/actions.ts). The only prompt-adjacent string kept here is the
 *     report TITLE, because it is stored and then rendered as a heading.
 *
 * The `tools` map is the exception that proves that rule: the thirteen registry
 * tool NAMES are rendered as chips under every assistant answer, so they need a
 * label per locale — while their `description` strings stay English in the
 * registry, since they are the vocabulary the model maps questions onto.
 */

export const adminAiEn = {
  /* ------------------------------------------------------------- users --- */
  users: {
    metaTitle: "Users",
    title: "Users",
    description:
      "Every account in the studio. Deactivate access or reset a lost authenticator — both are audited.",
    statActive: "Active",
    statActiveHint: "Enrolled and able to sign in",
    statInvited: "Invited",
    statInvitedHint: "Awaiting first enrollment",
    statDeactivated: "Deactivated",
    statDeactivatedHint: "Access revoked",
    emptyTitle: "No users yet",
    emptyDescription:
      "Users appear here once they accept an invitation and enroll their authenticator.",
    colUser: "User",
    colRole: "Role",
    colJoined: "Joined",
    statusActive: "Active",
    statusInvited: "Invited",
    statusDeactivated: "Deactivated",
    resetMfa: "Reset MFA",
    deactivate: "Deactivate",
    self: "You",
    deactivateTitle: "Deactivate user",
    deactivateBody: (name: string): string =>
      `${name} will lose all access immediately. Their status becomes “deactivated” and every active session is revoked.`,
    deactivateNote:
      "Re-enabling an account is done from the Supabase Dashboard. This is recorded in the audit log.",
    deactivateCta: "Deactivate",
    resetTitle: "Reset MFA factor",
    resetBody: (name: string): string =>
      `Delete ${name}’s authenticator factor and revoke their sessions. On next login they are forced to re-enroll a new TOTP factor.`,
    resetNote:
      "Only do this after verifying their identity out-of-band (docs/05 §8.1). This is recorded in the audit log.",
    resetCta: "Reset MFA",
    toastDeactivated: "User deactivated",
    toastMfaReset: "MFA reset",
    toastFailed: "Action failed",
    errInvalidUser: "Invalid user reference.",
    errSelfDeactivate: "You cannot deactivate your own account.",
    errLoadUser: "Could not load that user.",
    errUserNotFound: "User not found.",
    errSuperAdminProtected: "The Super Admin account cannot be deactivated.",
    errAlreadyDeactivated: "This user is already deactivated.",
    errDeactivateFailed: "Could not deactivate the user. Please try again.",
    errSelfMfaReset: "Reset your own factor through the Supabase Dashboard (docs/05 §8.2).",
    errNoFactor: "This user has no MFA factor to reset.",
    errNotAuthorized: "You are not authorized to perform this action.",
    okDeactivated: (name: string): string => `${name} has been deactivated.`,
    okMfaReset: (name: string): string => `MFA reset for ${name}. They must re-enroll on next login.`,
  },

  /* ------------------------------------------------------- invitations --- */
  invitations: {
    metaTitle: "Invitations",
    title: "Invitations",
    description:
      "Invite staff, models and operators. Accounts are created only after the invitee sets a password and enrolls TOTP.",
    statusPending: "Pending",
    statusAccepted: "Accepted",
    statusExpired: "Expired",
    statusRevoked: "Revoked",
    pendingCount: (n: number): string => `${n} pending ${n === 1 ? "invitation" : "invitations"}.`,
    colEmail: "Email",
    colRole: "Role",
    colPreLink: "Pre-link",
    colSent: "Sent",
    colExpires: "Expires",
    emptyTitle: "No invitations yet",
    emptyDescription:
      "Invite the first user to get started. They receive a one-time link to set a password and enroll two-factor authentication.",
    openCta: "Invite user",
    dialogTitle: "Invite a user",
    dialogDescription:
      "Sends a one-time invite email. The account is created only after they set a password and enroll TOTP.",
    submitCta: "Send invite",
    emailLabel: "Email",
    emailHelp: "The invite link is sent here. One live invite per address.",
    emailPlaceholder: "person@example.com",
    roleLabel: "Role",
    rolePlaceholder: "Select a role…",
    roleHelp: "Determines what the user can access.",
    preLinkModelLabel: "Pre-link model",
    preLinkModelHelp: "Links this login to an existing model record on signup.",
    preLinkOperatorLabel: "Pre-link operator",
    preLinkOperatorHelp: "Links this login to an existing operator record on signup.",
    preLinkNone: "No pre-link",
    roleRequiredTitle: "Role required",
    roleRequiredBody: "Choose the role this person will have.",
    toastSent: "Invitation sent",
    toastFailed: "Could not invite",
    errInvalidEmail: "Enter a valid email address.",
    errInvalidRole: "Select a valid role.",
    errInvalid: "Invalid invitation.",
    errDuplicate: "A pending invitation already exists for this email.",
    errCreateFailed: "Could not create the invitation. Please try again.",
    errAccountExists: "An account with this email already exists.",
    errSendFailed: "Could not send the invite email. Please try again.",
    errNotAuthorized: "You are not authorized to invite users.",
    okSent: (email: string): string => `Invitation sent to ${email}.`,
  },

  /* --------------------------------------------------------- audit log --- */
  auditLog: {
    metaTitle: "Audit log",
    title: "Audit log",
    description:
      "The append-only trail of every security-relevant event. Super Admin only; readable, never editable. Filter by action, actor and date.",
    statMatching: "Matching events",
    statTotal: "Total events",
    hintFiltered: "For the current filter",
    hintAll: "Across the whole trail",
    statThisPage: "This page",
    hintPerPage: (n: number): string => `Up to ${n} per page`,
    statPage: "Page",
    hintNewestFirst: "Newest first",
    filterAction: "Action",
    filterActor: "Actor",
    filterFrom: "From",
    filterTo: "To",
    allActors: "All actors",
    systemActors: "System / triggers",
    emptyTitle: "No matching events",
    emptyFiltered:
      "Nothing in the trail matches this filter. Widen the date range or clear the filter.",
    emptyAll: "The audit trail is empty. Events appear here as soon as they are recorded.",
    colWhen: "When",
    colActor: "Actor",
    colAction: "Action",
    colTarget: "Target",
    colDetails: "Details",
    colIp: "IP",
    systemBadge: "System",
    fieldsCount: (n: number): string => `${n} field${n === 1 ? "" : "s"}`,
    showingRange: (from: number, to: number, total: string): string =>
      `Showing ${from}–${to} of ${total}`,

    /** The action-prefix filter. Keys are DB prefixes and are never translated. */
    actionGroups: {
      all: "All actions",
      ai: "AI (ai.*)",
      settings: "Settings",
      user: "Users",
      auth: "Auth & MFA",
      account: "Platform accounts",
      model: "Models",
      operator: "Operators",
      platform: "Platforms",
      session: "Work sessions",
      earning: "Earnings",
      scheme: "Commission schemes",
      ledger: "Ledger",
      payout: "Payouts",
      forecast: "Forecasts",
      document: "Documents",
      share: "Document shares",
      library: "Library",
    },

    catalogTitle: "Verb catalogue",
    catalogDescription:
      "The canonical dotted-verb vocabulary of the audit trail (docs/04 §4.16, docs/05 §9).",
    catalogGroupAi: "AI & settings",
    catalogGroupUsers: "Users & auth",
    catalogGroupDocuments: "Documents & library",
    catalogGroupMoney: "Money",

    /** One line per dotted verb. The verbs themselves are DB values — untranslated. */
    verbs: {
      "ai.model_switch": "Active AI provider switched (old → new in metadata).",
      "ai.settings_update": "An ai.* setting changed — model ID or budget.",
      "ai.classify": "A Library file classified by the AI (one per provider crossing).",
      "ai.reindex": "Semantic-search embeddings rebuilt / re-embedded.",
      "ai.report_create": "An AI market report was generated.",
      "settings.update": "A non-AI application setting changed.",
      "user.create": "A profile row was created.",
      "user.invite": "An invitation was issued.",
      "user.deactivate": "An account was deactivated and its sessions revoked.",
      "user.reactivate": "A deactivated account was re-enabled.",
      "user.role_change": "A user's role changed.",
      "auth.mfa_enrolled": "A TOTP factor was enrolled.",
      "auth.mfa_reset": "A user's authenticator was reset.",
      "document.upload": "A compliance document was uploaded.",
      "document.download": "A document was downloaded via signed URL.",
      "share.create": "A shareable document link was created.",
      "share.revoke": "A share link was revoked.",
      "share.view": "A share link was opened by an anonymous viewer.",
      "library.upload": "A Library file was uploaded.",
      "library.categorize": "A Library file was filed under a category.",
      "payout.create": "A payout was drafted.",
      "payout.approve": "A payout was approved (maker-checker).",
      "payout.paid": "A payout was marked paid and settled to the ledger.",
      "payout.cancel": "A payout was cancelled.",
      "ledger.post": "A ledger entry (adjustment / deduction / share) was posted.",
      "scheme.update": "A commission scheme was created or amended.",
      "forecast.snapshot": "A forecast snapshot was taken for accuracy tracking.",
    },
  },

  /* ---------------------------------------------------------- settings --- */
  settings: {
    metaTitle: "Settings",
    title: "AI settings",
    description:
      "Switch the active AI provider, tune the chat, vision and embedding model IDs, and set the budget caps the gateway enforces before any provider call. Every change here is validated and audited (docs/11).",
    noKeyBanner: "The active provider has no API key.",
    noKeyBannerBody: (envVar: string): string =>
      `Set ${envVar} in the server environment. Until then the AI assistant, market reports and Library classification are paused and degrade gracefully (docs/11 §1).`,
    providerCardTitle: "Active AI provider",
    providerCardDescription:
      "Switching routes every AI request to a different third-party data processor — a governance event, confirmed and audited as ai.model_switch. Effective globally within 60 seconds.",
    recheckKeys: "Recheck keys",
    activeBadge: "Active",
    keyConfigured: "API key configured",
    keyMissing: "No API key",
    routeTo: "Route AI requests to",
    optionNoKey: (label: string): string => `${label} (no API key)`,
    switchCta: "Switch provider",
    switchDialogTitle: "Switch active AI provider?",
    switchDialogBody: (next: string, current: string): string =>
      `All AI requests will be routed to ${next} instead of ${current}. This changes the third-party data processor and is recorded in the audit log as ai.model_switch.`,
    switchDialogNote:
      "The switch is global and takes effect within 60 seconds. Stored embeddings are unaffected — the embedding provider is a separate setting.",
    switchDialogNoKey: (label: string, envVar: string): string =>
      `${label} has no API key (${envVar}). After switching, the AI surfaces will be paused until the key is set.`,
    toastSwitched: "Provider switched",
    toastSwitchFailed: "Switch failed",
    toastKeysRefreshed: "Key status refreshed",
    toastRefreshFailed: "Could not refresh",
    modelsTitle: "Model IDs",
    modelsDescription:
      "Model identifiers per provider. A version bump is a settings change here, never a deploy (docs/11 §2.1). Model IDs are configuration, never hardcoded.",
    chatModelMoonshot: "Chat model — Moonshot",
    chatModelMoonshotHelp: "Kimi chat model, used when Moonshot is the active provider.",
    chatModelZhipu: "Chat model — Zhipu",
    chatModelZhipuHelp: "GLM chat model, used when Zhipu is the active provider.",
    visionModelMoonshot: "Vision model — Moonshot",
    visionModelZhipu: "Vision model — Zhipu",
    visionModelHelp: "Vision-capable model for Library image / scanned-PDF classification.",
    embeddingModelLabel: "Embedding model",
    embeddingModelHelp:
      "fn_semantic_search filters on this value. Changing it strands existing vectors — re-embed via runbook 5.10.",
    embeddingProviderLabel: "Embedding provider",
    dimensionLabel: "Dimension",
    embeddingNote:
      "Provider and dimension are decoupled from the chat switch and change only via migration + re-embed (docs/11 §6.2).",
    unsavedChanges: (n: number): string => `${n} unsaved change${n === 1 ? "" : "s"}`,
    saveModels: "Save models",
    budgetsTitle: "Budgets",
    budgetsDescription:
      "The caps the gateway enforces against ai_usage before any provider call. Refusals are themselves metered, so abuse patterns stay visible (docs/11 §8).",
    limitRequestsLabel: "Requests / user / hour",
    limitRequestsUnit: "requests per hour",
    limitTokensUserLabel: "Tokens / user / day",
    limitTokensGlobalLabel: "Tokens / day (global)",
    limitTokensUnit: "tokens per day",
    limitHelp: (value: string, unit: string): string => `${value} ${unit}`,
    limitHelpInvalid: (unit: string): string => `Must be a positive whole number of ${unit}.`,
    saveBudgets: "Save budgets",
    toastSaved: "Saved",
    toastSaveFailed: "Could not save",

    /** Field labels used to build a validation message in the server action. */
    modelLabels: {
      "ai.chat_model.moonshot": "Moonshot chat model",
      "ai.chat_model.zhipu": "Zhipu chat model",
      "ai.vision_model.moonshot": "Moonshot vision model",
      "ai.vision_model.zhipu": "Zhipu vision model",
      "ai.embedding.model": "Embedding model",
    },
    limitLabels: {
      "ai.limits.requests_per_user_per_hour": "Requests per user per hour",
      "ai.limits.tokens_per_user_per_day": "Tokens per user per day",
      "ai.limits.tokens_global_per_day": "Tokens per day (global)",
    },
    /** The frame the field label and the zod issue are rendered into. */
    fieldIssue: (label: string, issue: string): string => `${label} ${issue}`,
    issueEmpty: "cannot be empty.",
    issueTooLong: "is too long.",
    issueNotInteger: "must be a whole number.",
    issueNotPositive: "must be greater than zero.",
    issueTooLarge: "is too large.",
    issueInvalid: "is invalid.",
    errChooseProvider: "Choose Moonshot or Zhipu.",
    errNotAuthorized: "You are not authorized to change AI settings.",
    errDbRejected: "That value was rejected by the database validation rule.",
    errSaveFailed: "Could not save the setting. Please try again.",
    errUnknownSetting: (key: string): string => `Unknown setting: ${key}.`,
    okSwitched: (label: string): string =>
      `Active provider switched to ${label}. Effective within 60 seconds.`,
    okNoChanges: "No changes to save.",
    okModelUpdated: "Model updated.",
    okModelsUpdated: "Models updated.",
    okBudgetUpdated: "Budget updated.",
    okBudgetsUpdated: "Budgets updated.",
  },

  /* ------------------------------------------------------------ hermes --- */
  hermes: {
    metaTitle: "Hermes",
    title: "Hermes",
    description:
      "The studio's agent proposes actions here and waits. It can raise work and it can carry out what you authorise, but it can never approve its own proposal — the database refuses that, not just the interface.",
    proposalFallback: "Proposal",
    statAwaiting: "Awaiting your decision",
    statFailed: "Failed",
    statAgent: "Agent",
    agentRunning: "Running",
    agentNeverStarted: "Never started",
    agentStalled: "Stalled",
    awaitingCardTitle: "Awaiting decision",
    healthTitle: "Worker health",
    healthDescription:
      "Each loop writes a heartbeat. A stalled loop means proposals may not be raised or carried out.",
    noHeartbeatsTitle: "No heartbeats recorded",
    noHeartbeatsDescription:
      "Hermes has not run yet. Once the worker is deployed it reports here within a minute.",
    colLoop: "Loop",
    colLastHeartbeat: "Last heartbeat",
    colState: "State",
    loopStalled: "Stalled",
    loopHealthy: "Healthy",
    jobsTitle: "Recent job runs",
    noJobsTitle: "No job runs yet",
    noJobsDescription: "Scheduled jobs report here once they run.",
    colJob: "Job",
    colStarted: "Started",
    colResult: "Result",
    jobSuccess: "Success",
    jobRunning: "Running",
    jobFailed: "Failed",
    historyTitle: "Decision history",
    historyDescription: "Every proposal Hermes has raised.",
    statePending: "Awaiting you",
    stateApproved: "Approved — executing",
    stateExecuted: "Done",
    stateRejected: "Rejected",
    stateFailed: "Failed",
    stateExpired: "Expired",
    emptyTitle: "Nothing awaiting a decision",
    emptyDescription:
      "Hermes proposes actions here when it finds work that needs your authorisation — an unclosed period, a payee with an outstanding balance. Proposals it can't execute alone will always wait for you.",
    colProposal: "Proposal",
    colRequires: "Requires",
    colRaised: "Raised",
    colDecision: "Decision",
    raisedBy: (job: string): string => ` · raised by ${job}`,
    afterAttempts: (n: number): string => ` (after ${n} attempt${n === 1 ? "" : "s"})`,
    decidedBy: (name: string, when: string): string => `by ${name}, ${when}`,
    reject: "Reject",
    approve: "Approve",
    recording: "Recording…",
    approveDialogTitle: "Approve this proposal?",
    rejectDialogTitle: "Reject this proposal?",
    approveDialogBody:
      "This will be carried out under your name, not the agent's. Hermes executes it within a few seconds.",
    noteLabel: "Note (optional)",
    notePlaceholder: "Recorded on the decision",
    okDecision: "Decision recorded.",
    okApproved: "Approved. Hermes will carry it out within a few seconds.",
    okRejected: "Rejected. Nothing will be executed.",
    errInvalidApproval: "Invalid approval.",
    errNoteTooLong: "Keep the note under 1000 characters.",
    errInvalidDecision: "Invalid decision.",
    errWrongRole:
      "You're not authorised to decide this proposal. It requires a different role.",
    errAlreadyDecided:
      "That proposal has already been decided. Refresh to see its current state.",
    errGone: "That proposal no longer exists.",
    errFailed: "The decision could not be recorded.",
  },

  /* --------------------------------------------------------- assistant --- */
  assistant: {
    metaTitle: "AI Assistant",
    title: "AI Assistant",
    description:
      "Ask operational and financial questions in plain language. The assistant reads only what your role can — through whitelisted, read-only tools, in aggregate — and never sees legal names, contact or payment details (docs/11).",
    newChat: "New chat",
    noConversations: "No conversations yet. Ask the assistant a question to begin.",
    untitledChat: "Untitled chat",
    notConfiguredTitle: "AI provider not configured",
    notConfiguredBody: (envVar: string): string =>
      `— add ${envVar} (or the other provider's key) in Vercel, then switch the active provider in Admin → Settings.`,
    aggregatesNote: "Answers come from your own RLS-scoped data — aggregates only.",
    emptyTitle: "Ask about the studio's numbers",
    emptyDescription:
      "Earnings, hours, payouts, balances, forecasts, compliance — the assistant reads only what you can, and only in aggregate. Try: “Top earners by net last month.”",
    placeholderNotConfigured: "AI is not configured.",
    placeholderAsk: "Ask a question… (Enter to send, Shift+Enter for a new line)",
    send: "Send",
    thinking: "Thinking…",
    notConfiguredShort: "AI provider not configured.",
    errUnavailable: "The assistant is unavailable right now.",
    errConversationMissing: "That conversation could not be found.",
    errRateLimited: "You have hit the hourly request limit. Try again soon.",
    errBudget: "The token budget for this window is exhausted.",
    errGeneric: "The assistant hit an error.",
    errNoAnswer: "The assistant returned no answer.",
    errInterrupted: "The connection to the assistant was interrupted.",

    /* Gateway (`/api/ai/chat`) JSON error bodies, surfaced verbatim in the UI. */
    errBodyNotJson: "Body must be JSON.",
    errMessageRequired: "`message` is required.",
    errLoadConversation: "Failed to load conversation.",
    errConversationNotFound: "Conversation not found.",
    errCreateConversation: "Failed to create conversation.",
    errRequestFailed: "AI request failed.",

    /* Budget refusals, streamed into the transcript as the assistant's reply. */
    refusalHourly: (limit: string): string =>
      `Hourly request limit reached (${limit}/hour). Try again later.`,
    refusalDailyTokens: (limit: string): string => `Daily token budget reached (${limit} tokens).`,
    refusalGlobalTokens:
      "The studio's daily AI token budget has been reached. Try again tomorrow.",

    /* NotConfiguredError — mostly log-facing, but rendered if it ever surfaces. */
    notConfiguredProvider: (provider: string): string =>
      `AI provider "${provider}" is not configured (missing API key).`,
    notConfigured: "AI is not configured.",
  },

  /* ----------------------------------------------------------- reports --- */
  reports: {
    metaTitle: "AI market reports",
    title: "AI market reports",
    description:
      "Monthly commentary generated from the studio's own aggregate figures. Only de-identified aggregates ever reach the AI provider.",
    notConfiguredTitle: "AI is not configured.",
    notConfiguredBody:
      "Set the active provider's API key to generate new reports. Any reports already generated remain readable below.",
    activeProvider: "Active provider:",
    emptyTitle: "No reports yet",
    emptyConfigured:
      "Generate this month's report to build a commentary from the studio's earnings, split distribution, forecast and balances.",
    emptyNotConfigured:
      "When AI is configured, generate a monthly report to build a commentary from the studio's own aggregates.",
    earlierReports: "Earlier reports",
    latest: "Latest",
    generatedAt: (when: string, model: string): string => `Generated ${when} · ${model}`,
    generateCta: "Generate monthly report",
    dialogTitle: "Generate this month's market report?",
    dialogDescription:
      "Builds a commentary from the studio's own aggregate figures — earnings, split distribution, forecast, forecast accuracy and payee balances — and stores it as a report.",
    dialogBody:
      "Only de-identified aggregates are sent to the AI provider — no individual names, and no document contents. Generating a report counts against the studio's AI budget and is recorded in the audit trail.",
    confirmCta: "Generate report",
    toastGenerated: "Report generated",
    toastNotConfigured: "AI not configured",
    toastFailed: "Could not generate report",
    /** Stored on the row and rendered as the report's heading. */
    reportTitle: (month: string): string => `Market insight — ${month}`,
    okGenerated: (title: string): string => `Generated “${title}”.`,
    errNotAuthorized: "You are not authorized to generate reports.",
    errNotConfigured:
      "AI is not configured. Set the active provider's API key to generate reports.",
    errNoAggregates: "There is no aggregate data yet to build a report from.",
    errBudget: "AI budget reached. Try again later.",
    errProvider: "The AI provider could not generate the report. Please try again.",
    errEmpty: "The provider returned an empty report. Please try again.",
    errDuplicate: "A report for this month already exists.",
    errStore: "Could not store the report. Please try again.",
  },

  /* ------------------------------------------------------------- tools --- */
  /**
   * Chip labels for the thirteen registry tools. Keys are the registry's
   * `ToolName` values and are never translated — only what the reader sees is.
   */
  tools: {
    earnings_summary: "Earnings summary",
    earnings_monthly: "Monthly earnings",
    hours_summary: "Hours worked",
    payout_summary: "Payout summary",
    payout_history: "Payout history",
    payee_balances: "Payee balances",
    payee_statement: "Payee statement",
    split_distribution: "Split distribution",
    forecast: "Forecast",
    forecast_accuracy: "Forecast accuracy",
    compliance_summary: "Compliance summary",
    semantic_search: "Semantic search",
    library_search: "Library search",
  },
};

export const adminAiRu: typeof adminAiEn = {
  /* ------------------------------------------------------------- users --- */
  users: {
    metaTitle: "Пользователи",
    title: "Пользователи",
    description:
      "Все учётные записи студии. Отключите доступ или сбросьте утерянный аутентификатор — обе операции фиксируются в журнале.",
    statActive: "Активные",
    statActiveHint: "Прошли регистрацию и могут входить",
    statInvited: "Приглашённые",
    statInvitedHint: "Ожидают первой регистрации",
    statDeactivated: "Отключённые",
    statDeactivatedHint: "Доступ отозван",
    emptyTitle: "Пользователей пока нет",
    emptyDescription:
      "Пользователи появятся здесь, как только примут приглашение и настроят аутентификатор.",
    colUser: "Пользователь",
    colRole: "Роль",
    colJoined: "Добавлен",
    statusActive: "Активен",
    statusInvited: "Приглашён",
    statusDeactivated: "Отключён",
    resetMfa: "Сбросить 2FA",
    deactivate: "Отключить",
    self: "Вы",
    deactivateTitle: "Отключить пользователя",
    deactivateBody: (name: string) =>
      `${name} немедленно потеряет весь доступ. Статус станет «отключён», все активные сессии будут прерваны.`,
    deactivateNote:
      "Повторное включение учётной записи выполняется в панели Supabase. Операция фиксируется в журнале действий.",
    deactivateCta: "Отключить",
    resetTitle: "Сбросить фактор 2FA",
    resetBody: (name: string) =>
      `Фактор аутентификации пользователя ${name} будет удалён, а сессии прерваны. При следующем входе потребуется заново настроить TOTP.`,
    resetNote:
      "Делайте это только после проверки личности по другому каналу (docs/05 §8.1). Операция фиксируется в журнале действий.",
    resetCta: "Сбросить 2FA",
    toastDeactivated: "Пользователь отключён",
    toastMfaReset: "2FA сброшена",
    toastFailed: "Действие не выполнено",
    errInvalidUser: "Некорректная ссылка на пользователя.",
    errSelfDeactivate: "Нельзя отключить собственную учётную запись.",
    errLoadUser: "Не удалось загрузить пользователя.",
    errUserNotFound: "Пользователь не найден.",
    errSuperAdminProtected: "Учётную запись супер-админа отключить нельзя.",
    errAlreadyDeactivated: "Этот пользователь уже отключён.",
    errDeactivateFailed: "Не удалось отключить пользователя. Попробуйте ещё раз.",
    errSelfMfaReset: "Свой собственный фактор сбрасывайте в панели Supabase (docs/05 §8.2).",
    errNoFactor: "У этого пользователя нет фактора 2FA для сброса.",
    errNotAuthorized: "У вас нет прав на это действие.",
    okDeactivated: (name: string) => `Пользователь ${name} отключён.`,
    okMfaReset: (name: string) =>
      `2FA сброшена для пользователя ${name}. При следующем входе потребуется новая настройка.`,
  },

  /* ------------------------------------------------------- invitations --- */
  invitations: {
    metaTitle: "Приглашения",
    title: "Приглашения",
    description:
      "Приглашайте сотрудников, моделей и операторов. Учётная запись создаётся только после того, как приглашённый задаст пароль и настроит TOTP.",
    statusPending: "Ожидает",
    statusAccepted: "Принято",
    statusExpired: "Истекло",
    statusRevoked: "Отозвано",
    pendingCount: (n: number) =>
      `${n} ${plural("ru", n, {
        one: "приглашение ожидает",
        few: "приглашения ожидают",
        many: "приглашений ожидают",
      })} ответа.`,
    colEmail: "Эл. почта",
    colRole: "Роль",
    colPreLink: "Привязка",
    colSent: "Отправлено",
    colExpires: "Истекает",
    emptyTitle: "Приглашений пока нет",
    emptyDescription:
      "Пригласите первого пользователя. Он получит одноразовую ссылку, чтобы задать пароль и включить двухфакторную аутентификацию.",
    openCta: "Пригласить пользователя",
    dialogTitle: "Приглашение пользователя",
    dialogDescription:
      "Отправляет одноразовое письмо-приглашение. Учётная запись создаётся только после того, как человек задаст пароль и настроит TOTP.",
    submitCta: "Отправить приглашение",
    emailLabel: "Эл. почта",
    emailHelp: "Ссылка-приглашение уйдёт на этот адрес. Одно активное приглашение на адрес.",
    emailPlaceholder: "person@example.com",
    roleLabel: "Роль",
    rolePlaceholder: "Выберите роль…",
    roleHelp: "Определяет, к чему у пользователя будет доступ.",
    preLinkModelLabel: "Привязать к модели",
    preLinkModelHelp: "Свяжет этот вход с существующей карточкой модели при регистрации.",
    preLinkOperatorLabel: "Привязать к оператору",
    preLinkOperatorHelp: "Свяжет этот вход с существующей карточкой оператора при регистрации.",
    preLinkNone: "Без привязки",
    roleRequiredTitle: "Нужна роль",
    roleRequiredBody: "Выберите роль, которая будет у этого человека.",
    toastSent: "Приглашение отправлено",
    toastFailed: "Не удалось пригласить",
    errInvalidEmail: "Введите корректный адрес эл. почты.",
    errInvalidRole: "Выберите корректную роль.",
    errInvalid: "Некорректное приглашение.",
    errDuplicate: "Для этого адреса уже есть активное приглашение.",
    errCreateFailed: "Не удалось создать приглашение. Попробуйте ещё раз.",
    errAccountExists: "Учётная запись с этим адресом уже существует.",
    errSendFailed: "Не удалось отправить письмо-приглашение. Попробуйте ещё раз.",
    errNotAuthorized: "У вас нет прав приглашать пользователей.",
    okSent: (email: string) => `Приглашение отправлено на ${email}.`,
  },

  /* --------------------------------------------------------- audit log --- */
  auditLog: {
    metaTitle: "Журнал действий",
    title: "Журнал действий",
    description:
      "Неизменяемая летопись всех событий, важных для безопасности. Только для супер-админа: читать можно, править — нет. Фильтруйте по действию, автору и дате.",
    statMatching: "Событий по фильтру",
    statTotal: "Всего событий",
    hintFiltered: "Для текущего фильтра",
    hintAll: "По всему журналу",
    statThisPage: "На этой странице",
    hintPerPage: (n: number) => `До ${n} на страницу`,
    statPage: "Страница",
    hintNewestFirst: "Сначала новые",
    filterAction: "Действие",
    filterActor: "Автор",
    filterFrom: "С",
    filterTo: "По",
    allActors: "Все авторы",
    systemActors: "Система / триггеры",
    emptyTitle: "Подходящих событий нет",
    emptyFiltered:
      "В журнале нет событий по этому фильтру. Расширьте период или очистите фильтр.",
    emptyAll: "Журнал пуст. События появятся здесь сразу после записи.",
    colWhen: "Когда",
    colActor: "Автор",
    colAction: "Действие",
    colTarget: "Объект",
    colDetails: "Подробности",
    colIp: "IP",
    systemBadge: "Система",
    fieldsCount: (n: number) =>
      `${n} ${plural("ru", n, { one: "поле", few: "поля", many: "полей" })}`,
    showingRange: (from: number, to: number, total: string) =>
      `Показано ${from}–${to} из ${total}`,

    actionGroups: {
      all: "Все действия",
      ai: "ИИ (ai.*)",
      settings: "Настройки",
      user: "Пользователи",
      auth: "Вход и 2FA",
      account: "Аккаунты площадок",
      model: "Модели",
      operator: "Операторы",
      platform: "Площадки",
      session: "Рабочие смены",
      earning: "Доходы",
      scheme: "Схемы комиссий",
      ledger: "Реестр операций",
      payout: "Выплаты",
      forecast: "Прогнозы",
      document: "Документы",
      share: "Ссылки на документы",
      library: "Библиотека",
    },

    catalogTitle: "Справочник действий",
    catalogDescription:
      "Канонический словарь точечных глаголов журнала действий (docs/04 §4.16, docs/05 §9).",
    catalogGroupAi: "ИИ и настройки",
    catalogGroupUsers: "Пользователи и вход",
    catalogGroupDocuments: "Документы и библиотека",
    catalogGroupMoney: "Финансы",

    verbs: {
      "ai.model_switch": "Переключён активный ИИ-провайдер (старое → новое в метаданных).",
      "ai.settings_update": "Изменена настройка ai.* — идентификатор модели или лимит.",
      "ai.classify": "Файл библиотеки классифицирован ИИ (по одной записи на обращение).",
      "ai.reindex": "Векторы семантического поиска пересобраны.",
      "ai.report_create": "Сформирован отчёт ИИ по рынку.",
      "settings.update": "Изменена настройка приложения, не связанная с ИИ.",
      "user.create": "Создана карточка профиля.",
      "user.invite": "Выдано приглашение.",
      "user.deactivate": "Учётная запись отключена, её сессии прерваны.",
      "user.reactivate": "Отключённая учётная запись включена снова.",
      "user.role_change": "Изменена роль пользователя.",
      "auth.mfa_enrolled": "Настроен фактор TOTP.",
      "auth.mfa_reset": "Сброшен аутентификатор пользователя.",
      "document.upload": "Загружен документ соответствия.",
      "document.download": "Документ скачан по подписанной ссылке.",
      "share.create": "Создана ссылка для передачи документа.",
      "share.revoke": "Ссылка на документ отозвана.",
      "share.view": "Ссылку открыл анонимный получатель.",
      "library.upload": "Загружен файл в библиотеку.",
      "library.categorize": "Файл библиотеки отнесён к категории.",
      "payout.create": "Создан черновик выплаты.",
      "payout.approve": "Выплата утверждена (принцип двух рук).",
      "payout.paid": "Выплата отмечена оплаченной и проведена в реестр.",
      "payout.cancel": "Выплата отменена.",
      "ledger.post": "Проведена запись реестра (корректировка, удержание или доля).",
      "scheme.update": "Создана или изменена схема комиссий.",
      "forecast.snapshot": "Сделан снимок прогноза для оценки точности.",
    },
  },

  /* ---------------------------------------------------------- settings --- */
  settings: {
    metaTitle: "Настройки",
    title: "Настройки ИИ",
    description:
      "Переключите активного ИИ-провайдера, задайте идентификаторы моделей для чата, зрения и векторов и установите лимиты, которые шлюз проверяет до любого обращения к провайдеру. Каждое изменение проверяется и фиксируется в журнале (docs/11).",
    noKeyBanner: "У активного провайдера нет API-ключа.",
    noKeyBannerBody: (envVar: string) =>
      `Задайте ${envVar} в серверном окружении. До этого ИИ-ассистент, отчёты по рынку и классификация библиотеки приостановлены и деградируют штатно (docs/11 §1).`,
    providerCardTitle: "Активный ИИ-провайдер",
    providerCardDescription:
      "Переключение направляет все запросы ИИ другому стороннему обработчику данных — это управленческое решение, оно подтверждается и фиксируется как ai.model_switch. Действует глобально в течение 60 секунд.",
    recheckKeys: "Проверить ключи",
    activeBadge: "Активен",
    keyConfigured: "API-ключ задан",
    keyMissing: "Нет API-ключа",
    routeTo: "Направлять запросы ИИ в",
    optionNoKey: (label: string) => `${label} (нет API-ключа)`,
    switchCta: "Переключить провайдера",
    switchDialogTitle: "Переключить активного ИИ-провайдера?",
    switchDialogBody: (next: string, current: string) =>
      `Все запросы ИИ пойдут в ${next} вместо ${current}. Это меняет стороннего обработчика данных и фиксируется в журнале как ai.model_switch.`,
    switchDialogNote:
      "Переключение действует глобально и вступает в силу в течение 60 секунд. Сохранённые векторы не затрагиваются — провайдер векторов задаётся отдельно.",
    switchDialogNoKey: (label: string, envVar: string) =>
      `У ${label} нет API-ключа (${envVar}). После переключения поверхности ИИ будут приостановлены, пока ключ не задан.`,
    toastSwitched: "Провайдер переключён",
    toastSwitchFailed: "Не удалось переключить",
    toastKeysRefreshed: "Статус ключей обновлён",
    toastRefreshFailed: "Не удалось обновить",
    modelsTitle: "Идентификаторы моделей",
    modelsDescription:
      "Идентификаторы моделей по провайдерам. Смена версии — это изменение настройки здесь, а не деплой (docs/11 §2.1). Идентификаторы моделей всегда конфигурация, никогда не код.",
    chatModelMoonshot: "Модель чата — Moonshot",
    chatModelMoonshotHelp: "Модель Kimi для чата, когда активен Moonshot.",
    chatModelZhipu: "Модель чата — Zhipu",
    chatModelZhipuHelp: "Модель GLM для чата, когда активен Zhipu.",
    visionModelMoonshot: "Модель зрения — Moonshot",
    visionModelZhipu: "Модель зрения — Zhipu",
    visionModelHelp:
      "Модель с поддержкой изображений для классификации картинок и сканов PDF в библиотеке.",
    embeddingModelLabel: "Модель векторов",
    embeddingModelHelp:
      "fn_semantic_search фильтрует по этому значению. Смена оставит существующие векторы без пары — переиндексируйте по runbook 5.10.",
    embeddingProviderLabel: "Провайдер векторов",
    dimensionLabel: "Размерность",
    embeddingNote:
      "Провайдер и размерность не связаны с переключателем чата и меняются только через миграцию и переиндексацию (docs/11 §6.2).",
    unsavedChanges: (n: number) =>
      `${n} ${plural("ru", n, {
        one: "несохранённое изменение",
        few: "несохранённых изменения",
        many: "несохранённых изменений",
      })}`,
    saveModels: "Сохранить модели",
    budgetsTitle: "Лимиты",
    budgetsDescription:
      "Лимиты, которые шлюз проверяет по ai_usage до любого обращения к провайдеру. Отказы тоже учитываются, поэтому злоупотребления остаются видимыми (docs/11 §8).",
    limitRequestsLabel: "Запросов / пользователь / час",
    limitRequestsUnit: "запросов в час",
    limitTokensUserLabel: "Токенов / пользователь / день",
    limitTokensGlobalLabel: "Токенов / день (всего)",
    limitTokensUnit: "токенов в день",
    limitHelp: (value: string, unit: string) => `${value} ${unit}`,
    limitHelpInvalid: (unit: string) => `Нужно целое положительное число: ${unit}.`,
    saveBudgets: "Сохранить лимиты",
    toastSaved: "Сохранено",
    toastSaveFailed: "Не удалось сохранить",

    modelLabels: {
      "ai.chat_model.moonshot": "Модель чата Moonshot",
      "ai.chat_model.zhipu": "Модель чата Zhipu",
      "ai.vision_model.moonshot": "Модель зрения Moonshot",
      "ai.vision_model.zhipu": "Модель зрения Zhipu",
      "ai.embedding.model": "Модель векторов",
    },
    limitLabels: {
      "ai.limits.requests_per_user_per_hour": "Запросов на пользователя в час",
      "ai.limits.tokens_per_user_per_day": "Токенов на пользователя в день",
      "ai.limits.tokens_global_per_day": "Токенов в день (всего)",
    },
    fieldIssue: (label: string, issue: string) => `Поле «${label}»: ${issue}`,
    issueEmpty: "не может быть пустым.",
    issueTooLong: "слишком длинное.",
    issueNotInteger: "должно быть целым числом.",
    issueNotPositive: "должно быть больше нуля.",
    issueTooLarge: "слишком большое.",
    issueInvalid: "заполнено некорректно.",
    errChooseProvider: "Выберите Moonshot или Zhipu.",
    errNotAuthorized: "У вас нет прав менять настройки ИИ.",
    errDbRejected: "Значение отклонено правилом проверки в базе данных.",
    errSaveFailed: "Не удалось сохранить настройку. Попробуйте ещё раз.",
    errUnknownSetting: (key: string) => `Неизвестная настройка: ${key}.`,
    okSwitched: (label: string) =>
      `Активный провайдер переключён на ${label}. Вступит в силу в течение 60 секунд.`,
    okNoChanges: "Изменений для сохранения нет.",
    okModelUpdated: "Модель обновлена.",
    okModelsUpdated: "Модели обновлены.",
    okBudgetUpdated: "Лимит обновлён.",
    okBudgetsUpdated: "Лимиты обновлены.",
  },

  /* ------------------------------------------------------------ hermes --- */
  hermes: {
    metaTitle: "Гермес",
    title: "Гермес",
    description:
      "Агент студии предлагает здесь действия и ждёт. Он может находить работу и выполнять то, что вы разрешили, но никогда не может утвердить собственное предложение — это запрещает база данных, а не только интерфейс.",
    proposalFallback: "Предложение",
    statAwaiting: "Ждут вашего решения",
    statFailed: "С ошибкой",
    statAgent: "Агент",
    agentRunning: "Работает",
    agentNeverStarted: "Ни разу не запускался",
    agentStalled: "Завис",
    awaitingCardTitle: "Ожидают решения",
    healthTitle: "Состояние воркера",
    healthDescription:
      "Каждый цикл пишет сигнал активности. Зависший цикл означает, что предложения могут не создаваться и не выполняться.",
    noHeartbeatsTitle: "Сигналов активности нет",
    noHeartbeatsDescription:
      "Гермес ещё не запускался. После развёртывания воркер отчитается здесь в течение минуты.",
    colLoop: "Цикл",
    colLastHeartbeat: "Последний сигнал",
    colState: "Состояние",
    loopStalled: "Завис",
    loopHealthy: "В норме",
    jobsTitle: "Последние запуски задач",
    noJobsTitle: "Запусков пока не было",
    noJobsDescription: "Регламентные задачи отчитаются здесь после первого запуска.",
    colJob: "Задача",
    colStarted: "Запуск",
    colResult: "Результат",
    jobSuccess: "Успешно",
    jobRunning: "Выполняется",
    jobFailed: "Ошибка",
    historyTitle: "История решений",
    historyDescription: "Все предложения, созданные Гермесом.",
    statePending: "Ждёт вас",
    stateApproved: "Утверждено — выполняется",
    stateExecuted: "Выполнено",
    stateRejected: "Отклонено",
    stateFailed: "Ошибка",
    stateExpired: "Истекло",
    emptyTitle: "Решений не требуется",
    emptyDescription:
      "Гермес предлагает здесь действия, когда находит работу, требующую вашего разрешения: незакрытый период, получателя с непогашенным остатком. Всё, что он не может выполнить сам, всегда ждёт вас.",
    colProposal: "Предложение",
    colRequires: "Требует",
    colRaised: "Создано",
    colDecision: "Решение",
    raisedBy: (job: string) => ` · создано задачей ${job}`,
    afterAttempts: (n: number) =>
      ` (после ${n} ${plural("ru", n, {
        one: "попытки",
        few: "попыток",
        many: "попыток",
      })})`,
    decidedBy: (name: string, when: string) => `${name}, ${when}`,
    reject: "Отклонить",
    approve: "Утвердить",
    recording: "Записываем…",
    approveDialogTitle: "Утвердить это предложение?",
    rejectDialogTitle: "Отклонить это предложение?",
    approveDialogBody:
      "Действие будет выполнено от вашего имени, а не от имени агента. Гермес выполнит его за несколько секунд.",
    noteLabel: "Комментарий (необязательно)",
    notePlaceholder: "Сохраняется вместе с решением",
    okDecision: "Решение записано.",
    okApproved: "Утверждено. Гермес выполнит это за несколько секунд.",
    okRejected: "Отклонено. Ничего выполнено не будет.",
    errInvalidApproval: "Некорректное предложение.",
    errNoteTooLong: "Комментарий должен быть короче 1000 символов.",
    errInvalidDecision: "Некорректное решение.",
    errWrongRole: "У вас нет прав решать по этому предложению. Требуется другая роль.",
    errAlreadyDecided:
      "Решение по этому предложению уже принято. Обновите страницу, чтобы увидеть его состояние.",
    errGone: "Этого предложения больше нет.",
    errFailed: "Не удалось записать решение.",
  },

  /* --------------------------------------------------------- assistant --- */
  assistant: {
    metaTitle: "ИИ-ассистент",
    title: "ИИ-ассистент",
    description:
      "Задавайте операционные и финансовые вопросы обычным языком. Ассистент читает только то, что доступно вашей роли, — через разрешённые инструменты только для чтения и только в агрегатах, — и никогда не видит юридических имён, контактов и платёжных данных (docs/11).",
    newChat: "Новый чат",
    noConversations: "Диалогов пока нет. Задайте ассистенту вопрос, чтобы начать.",
    untitledChat: "Без названия",
    notConfiguredTitle: "ИИ-провайдер не настроен",
    notConfiguredBody: (envVar: string) =>
      `— добавьте ${envVar} (или ключ второго провайдера) в Vercel, затем переключите активного провайдера в разделе «Администрирование → Настройки».`,
    aggregatesNote: "Ответы строятся только по доступным вам данным — и только в агрегатах.",
    emptyTitle: "Спросите о цифрах студии",
    emptyDescription:
      "Доходы, часы, выплаты, остатки, прогнозы, соответствие требованиям — ассистент читает только то, что доступно вам, и только в агрегатах. Попробуйте: «Кто заработал больше всех по чистому доходу в прошлом месяце».",
    placeholderNotConfigured: "ИИ не настроен.",
    placeholderAsk: "Задайте вопрос… (Enter — отправить, Shift+Enter — новая строка)",
    send: "Отправить",
    thinking: "Думаю…",
    notConfiguredShort: "ИИ-провайдер не настроен.",
    errUnavailable: "Ассистент сейчас недоступен.",
    errConversationMissing: "Этот диалог не найден.",
    errRateLimited: "Достигнут часовой лимит запросов. Попробуйте чуть позже.",
    errBudget: "Лимит токенов на это окно исчерпан.",
    errGeneric: "Ассистент столкнулся с ошибкой.",
    errNoAnswer: "Ассистент не вернул ответа.",
    errInterrupted: "Соединение с ассистентом прервалось.",

    errBodyNotJson: "Тело запроса должно быть в формате JSON.",
    errMessageRequired: "Поле `message` обязательно.",
    errLoadConversation: "Не удалось загрузить диалог.",
    errConversationNotFound: "Диалог не найден.",
    errCreateConversation: "Не удалось создать диалог.",
    errRequestFailed: "Запрос к ИИ не выполнен.",

    refusalHourly: (limit: string) =>
      `Достигнут часовой лимит запросов (${limit} в час). Попробуйте позже.`,
    refusalDailyTokens: (limit: string) =>
      `Достигнут дневной лимит токенов (${limit} токенов).`,
    refusalGlobalTokens:
      "Дневной лимит токенов ИИ для всей студии исчерпан. Попробуйте завтра.",

    notConfiguredProvider: (provider: string) =>
      `ИИ-провайдер «${provider}» не настроен (нет API-ключа).`,
    notConfigured: "ИИ не настроен.",
  },

  /* ----------------------------------------------------------- reports --- */
  reports: {
    metaTitle: "Отчёты ИИ по рынку",
    title: "Отчёты ИИ по рынку",
    description:
      "Ежемесячный обзор, построенный по собственным агрегатам студии. К ИИ-провайдеру попадают только обезличенные агрегаты.",
    notConfiguredTitle: "ИИ не настроен.",
    notConfiguredBody:
      "Задайте API-ключ активного провайдера, чтобы формировать новые отчёты. Уже созданные отчёты остаются доступными ниже.",
    activeProvider: "Активный провайдер:",
    emptyTitle: "Отчётов пока нет",
    emptyConfigured:
      "Сформируйте отчёт за этот месяц, чтобы получить обзор по доходам, распределению долей, прогнозу и остаткам студии.",
    emptyNotConfigured:
      "Когда ИИ будет настроен, сформируйте месячный отчёт — обзор по собственным агрегатам студии.",
    earlierReports: "Более ранние отчёты",
    latest: "Последний",
    generatedAt: (when: string, model: string) => `Сформирован ${when} · ${model}`,
    generateCta: "Сформировать месячный отчёт",
    dialogTitle: "Сформировать отчёт по рынку за этот месяц?",
    dialogDescription:
      "Строит обзор по собственным агрегатам студии — доходы, распределение долей, прогноз, точность прогноза и остатки получателей — и сохраняет его как отчёт.",
    dialogBody:
      "ИИ-провайдеру передаются только обезличенные агрегаты — без имён и без содержимого документов. Формирование отчёта расходует лимит ИИ студии и фиксируется в журнале действий.",
    confirmCta: "Сформировать отчёт",
    toastGenerated: "Отчёт сформирован",
    toastNotConfigured: "ИИ не настроен",
    toastFailed: "Не удалось сформировать отчёт",
    reportTitle: (month: string) => `Обзор рынка — ${month}`,
    okGenerated: (title: string) => `Сформирован отчёт «${title}».`,
    errNotAuthorized: "У вас нет прав формировать отчёты.",
    errNotConfigured:
      "ИИ не настроен. Задайте API-ключ активного провайдера, чтобы формировать отчёты.",
    errNoAggregates: "Пока нет агрегированных данных, по которым можно построить отчёт.",
    errBudget: "Лимит ИИ исчерпан. Попробуйте позже.",
    errProvider: "ИИ-провайдер не смог сформировать отчёт. Попробуйте ещё раз.",
    errEmpty: "Провайдер вернул пустой отчёт. Попробуйте ещё раз.",
    errDuplicate: "Отчёт за этот месяц уже существует.",
    errStore: "Не удалось сохранить отчёт. Попробуйте ещё раз.",
  },

  /* ------------------------------------------------------------- tools --- */
  tools: {
    earnings_summary: "Сводка доходов",
    earnings_monthly: "Доходы по месяцам",
    hours_summary: "Отработанные часы",
    payout_summary: "Сводка выплат",
    payout_history: "История выплат",
    payee_balances: "Остатки получателей",
    payee_statement: "Отчёт получателя",
    split_distribution: "Распределение долей",
    forecast: "Прогноз",
    forecast_accuracy: "Точность прогноза",
    compliance_summary: "Сводка по документам",
    semantic_search: "Семантический поиск",
    library_search: "Поиск по библиотеке",
  },
};
