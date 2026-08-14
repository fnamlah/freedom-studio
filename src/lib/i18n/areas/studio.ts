import { plural } from "../locales";

/**
 * The Studio entities: models, operators, platforms & platform accounts, work
 * sessions and earnings.
 *
 * `lifecycleStatus` is deliberately ONE map. `model_status` is the same Postgres
 * enum for models and operators (docs/04 §4.3), `MODEL_STATUS_META` and
 * `OPERATOR_STATUS_META` were byte-identical, and translating it twice is how the
 * two drift apart. The Russian labels are the short predicative forms
 * («Активен», «Завершён») precisely because they have to serve both «модель»
 * (feminine) and «оператор» (masculine) from a single string.
 *
 * The other three status maps ARE separate, because they describe different
 * things: an account is «Приостановлен», a platform is «Активна», an assignment
 * «Действует».
 */

export const studioEn = {
  /* ------------------------------------------------------------ enum labels --- */

  /** `model_status` — shared by models and operators (docs/04 §4.2, §4.3). */
  /** What kind of team member someone is — the variables around the model. */
  staffRole: {
    operator: "Operator",
    coach: "Coach",
    team_leader: "Team leader",
  },
  staffRoleLabel: "Role in the group",
  staffRoleHelp: "Operators chat, coaches develop the model, team leaders run the group. All three share the team pool.",
  groupTitle: "Group",
  groupDescription: "The model is the constant. Operators, coaches and team leaders are the variables — assign as many or as few as this model needs.",
  groupModel: "Model",
  groupTeam: "Team",
  groupEmpty: "No one assigned yet. This model's whole team share stays with the studio.",
  groupPoolNote: (percent: string) => `The team pool is ${percent} of net earnings, split by the weights below.`,
  groupUnallocated: (percent: string) => `${percent} of the pool is unassigned and stays with the studio.`,
  lifecycleStatus: {
    active: "Active",
    inactive: "Inactive",
    on_leave: "On leave",
    terminated: "Terminated",
  },

  /** `account_status` — a model's account on a platform (docs/04 §4.5). */
  accountStatus: {
    active: "Active",
    suspended: "Suspended",
    closed: "Closed",
  },

  /** A platform's `is_active` flag rendered as a status (docs/04 §4.4). */
  platformActive: {
    active: "Active",
    inactive: "Inactive",
  },

  /** Where an assignment's date window sits relative to today (docs/04 §4.8). */
  assignmentActivity: {
    active: "Active",
    upcoming: "Upcoming",
    ended: "Ended",
  },

  /* ---------------------------------------------------------------- models --- */

  models: {
    metaTitle: "Models",
    title: "Models",
    description:
      "Every performer's business record. Add a model, then link platform accounts, earnings and compliance documents.",

    statTotal: "Total",
    statTotalHint: "All roster records",
    statActive: "Active",
    statActiveHint: "Currently working",
    statOnLeave: "On leave",
    statOnLeaveHint: "Temporarily paused",
    statTerminated: "Terminated",
    statTerminatedHint: "Ended engagement",

    filterLabel: "Filter",
    filterAria: "Filter models by status",
    allStatuses: "All statuses",
    shown: (shown: number, total: number) => `${shown} of ${total} shown`,

    emptyTitle: "No models to show",
    emptyDescription:
      "No models match this filter. Add one, or clear the status filter to see the full roster.",
    colModel: "Model",
    colCountry: "Country",
    colStartDate: "Start date",
    colCommission: "Commission",
    colStatus: "Status",

    /* form */
    newModel: "New model",
    createTitle: "Add a model",
    editTitle: "Edit model",
    createDescription:
      "Create the business record. A self-service login can be linked later via an invite.",
    editDescription:
      "Update this model's profile. Lifecycle status is changed from the header.",
    submitCreate: "Add model",
    submitEdit: "Save changes",

    fieldStageName: "Stage name",
    placeholderStageName: "Public working name",
    fieldLegalName: "Legal name",
    placeholderLegalName: "Full legal name",
    helpLegalName: "Sensitive — visible to Super Admin and Managers only.",
    fieldDob: "Date of birth",
    helpDob: "Must be 18 or older — enforced by the database.",
    fieldCommission: "Commission %",
    hintCommission: "0–100%",
    helpCommission: "Legacy studio-cut default, superseded by commission schemes.",
    fieldEmail: "Email",
    placeholderEmail: "model@example.com",
    fieldPhone: "Phone",
    placeholderPhone: "Optional",
    fieldCountry: "Country",
    helpCountry: "ISO 3166-1 alpha-2, e.g. US, GB.",
    fieldStartDate: "Start date",
    fieldStatus: "Status",
    helpStatus: "Lifecycle state. Change it later from the model's page.",
    fieldNotes: "Notes",
    helpNotes: "Internal only — never shown in self-service views.",
    placeholderNotes: "Anything the team should know",

    toastCreated: "Model added",
    toastUpdated: "Model updated",
    toastCreateFailed: "Could not add model",
    toastUpdateFailed: "Could not update model",
    toastStatusChanged: "Status changed",
    toastStatusFailed: "Could not change status",
    statusControlLabel: "Status",
    statusControlAria: "Change model status",

    /* detail */
    detailMetaFallback: "Model",
    tabsAria: "Model detail sections",
    tabProfile: "Profile",
    tabAccounts: "Platform accounts",
    tabEarnings: "Recent earnings",
    tabCompliance: "Documents & compliance",

    profileTitle: "Profile",
    profileDescription:
      "Business record. Sensitive fields are visible to Super Admin and Managers only.",
    rowStageName: "Stage name",
    rowLegalName: "Legal name",
    rowDob: "Date of birth",
    rowCountry: "Country",
    rowStartDate: "Start date",
    rowStatus: "Status",
    rowCommissionLegacy: "Commission (legacy)",
    rowEmail: "Email",
    rowPhone: "Phone",
    rowSelfService: "Self-service login",
    linked: "Linked",
    notLinked: "Not linked",
    rowCreated: "Created",
    notesHeading: "Notes",
    sensitive: "Sensitive",

    accountsTitle: "Platform accounts",
    accountsDescription: "Accounts this model holds across the studio's platforms.",
    accountsEmptyTitle: "No platform accounts",
    accountsEmptyDescription: "Platform accounts are managed from the Platforms module.",
    colPlatform: "Platform",
    colUsername: "Username",
    colPlatformFee: "Platform fee",

    earningsTitle: "Recent earnings",
    earningsDescription:
      "The 10 most recent statement periods. Earnings are the money source of truth (docs/04 §4.7).",
    earningsEmptyTitle: "No earnings recorded",
    earningsEmptyDescription: "Statement periods are recorded from the Earnings module.",
    colPeriod: "Period",
    colAccount: "Account",
    colGross: "Gross",
    colNet: "Net",

    statDocuments: "Documents",
    statDocumentsHint: (n: number) => `${n} active`,
    statValid: "Valid",
    statValidHint: "Not expiring soon",
    statExpiring: "Expiring",
    statExpiringHint: "Within 30 days",
    statExpired: "Expired",
    statExpiredHint: "Past expiry",
    complianceTitle: "Compliance status",
    complianceDescription:
      "Derived from document expiry dates (docs/07). Documents live in the Documents module.",
    complianceEmptyTitle: "No documents on file",
    complianceEmptyDescription:
      "Identity and compliance documents are uploaded from the Documents module.",
    complianceExpired: (n: number) =>
      `${n} ${plural("en", n, { one: "document", other: "documents" })} expired. Renewal is required to keep this model compliant.`,
    complianceExpiring: (n: number) =>
      `${n} ${plural("en", n, { one: "document", other: "documents" })} expiring within 30 days. Plan renewals soon.`,
    complianceAllValid: "All documents are valid.",

    /* server actions */
    errDobInvalid: "Enter a valid date of birth (YYYY-MM-DD).",
    errAdult: "Models must be at least 18 years old.",
    errDateInvalid: "Enter a valid date (YYYY-MM-DD).",
    errEmail: "Enter a valid email address.",
    errPhoneLong: "Phone number is too long.",
    errCountry: "Use a 2-letter ISO country code.",
    errTelegramUsername: "A Telegram username is 5–32 letters, digits or underscores.",
    telegramLabel: "Telegram username",
    errNotesLong: "Notes are too long.",
    errCommissionType: "Enter a commission percentage.",
    errCommissionMin: "Commission can't be negative.",
    errCommissionMax: "Commission can't exceed 100%.",
    errStageNameRequired: "Stage name is required.",
    errLegalNameRequired: "Legal name is required.",
    errForm: "Please check the form and try again.",
    errDbCheck:
      "That doesn't satisfy a database rule — check the date of birth (18+) and commission (0–100%).",
    errDuplicate: "A model with those details already exists.",
    errSaveFailed: "Could not save the model. Please try again.",
    errGone: "That model no longer exists.",
    errLoadFailed: "Could not load that model.",
    errInvalidStatus: "Invalid status change.",
    errStatusFailed: "Could not change the status. Please try again.",
    errNotAuthorizedAdd: "You are not authorized to add models.",
    errNotAuthorizedEdit: "You are not authorized to edit models.",
    errNotAuthorizedStatus: "You are not authorized to change model status.",
    msgAdded: (name: string) => `${name} added.`,
    msgUpdated: "Model updated.",
    msgAlreadyStatus: (status: string) => `Model is already ${status.toLowerCase()}.`,
    msgStatusChanged: (name: string, status: string) =>
      `${name} is now ${status.toLowerCase()}.`,
  },

  /* ------------------------------------------------------------- operators --- */

  operators: {
    metaTitle: "Operators",
    title: "Operators",
    description:
      "Support staff who share in model revenue. Assign them to models with a pool share and period.",

    statOperators: "Operators",
    statOperatorsHint: "Total business records",
    statActive: "Active",
    statActiveHint: "Current lifecycle status",
    statAssigned: "Assigned",
    statAssignedHint: "With an active model assignment",

    emptyTitle: "No operators yet",
    emptyDescription:
      "Add the first operator to start assigning them to models and crediting them a share of the operator pool.",
    colOperator: "Operator",
    colStatus: "Status",
    colAssignments: "Assignments",
    colCountry: "Country",
    colStarted: "Started",
    loginLinked: "Login linked",
    activeCount: (n: number) => `(${n} active)`,

    /* form */
    newOperator: "New operator",
    createTitle: "Add an operator",
    editTitle: "Edit operator",
    createDescription:
      "Create the business record. A self-service login can be linked later via an invite.",
    editDescription:
      "Update this operator's profile. Lifecycle status is changed from the header.",
    submitCreate: "Add operator",
    submitEdit: "Save changes",

    fieldDisplayName: "Display name",
    placeholderDisplayName: "Working name",
    fieldLegalName: "Legal name",
    placeholderLegalName: "Full legal name",
    helpLegalName: "Sensitive — visible to Super Admin and Managers only.",
    fieldEmail: "Email",
    placeholderEmail: "operator@example.com",
    fieldPhone: "Phone",
    placeholderPhone: "Optional",
    fieldCountry: "Country",
    helpCountry: "ISO 3166-1 alpha-2, e.g. US, GB.",
    fieldStartDate: "Start date",
    fieldStatus: "Status",
    helpStatus: "Lifecycle state. Change it later from the operator's page.",
    fieldNotes: "Notes",
    helpNotes: "Internal only — never shown in self-service views.",
    placeholderNotes: "Anything the team should know",

    toastCreated: "Operator added",
    toastUpdated: "Operator updated",
    toastCreateFailed: "Could not add operator",
    toastUpdateFailed: "Could not update operator",

    /* status control */
    changeStatus: "Change status",
    statusDialogTitle: "Change status",
    statusDialogDescription: "Lifecycle changes are recorded in the audit log.",
    helpStatusDialog:
      "Terminated operators keep their assignment history — it can never be deleted.",
    toastStatusChanged: "Status updated",
    toastStatusFailed: "Could not change status",

    /* detail */
    detailMetaTitle: "Operator",
    detailDescription: "Operator business record, model assignments, and pool shares.",
    profileTitle: "Profile",
    profileDescription: "Sensitive fields are visible to Super Admin and Managers only.",
    rowLegalName: "Legal name",
    rowEmail: "Email",
    rowPhone: "Phone",
    rowCountry: "Country",
    rowStartDate: "Start date",
    rowSelfService: "Self-service login",
    linked: "Linked",
    notLinked: "Not linked",
    rowCreated: "Created",
    rowNotes: "Notes",
    unknownModel: "Unknown model",

    /* assignments */
    assignmentsTitle: "Assignments",
    assignmentsDescription:
      "Models this operator serves, their pool share, and the active period.",
    newAssignment: "New assignment",
    assignmentsEmptyTitle: "No assignments yet",
    assignmentsEmptyNoModels: "Create a model first, then assign this operator to it.",
    assignmentsEmptyDescription:
      "Assign this operator to a model to start crediting them a share of its operator pool.",
    colModel: "Model",
    colPoolShare: "Pool share",
    colPeriod: "Period",
    colState: "State",
    openEnded: "(open-ended)",
    remove: "Remove",

    assignmentCreateTitle: "New assignment",
    assignmentEditTitle: "Edit assignment",
    assignmentDialogDescription:
      "The operator pool for a model can never exceed 100%, and windows for the same model can't overlap — both are enforced by the database.",
    assignmentSubmitCreate: "Create assignment",
    assignmentSubmitEdit: "Save changes",
    fieldModel: "Model",
    helpModel: "The model this operator serves.",
    selectModel: "Select a model…",
    fieldPoolShare: "Pool share %",
    hintPoolShare: "0–100%",
    helpPoolShare:
      "This operator's slice of the model's operator pool. All operators on one model must sum to ≤ 100%.",
    fieldAssignedFrom: "Assigned from",
    fieldAssignedTo: "Assigned to",
    helpAssignedTo: "Leave blank for an open-ended assignment.",
    fieldAssignmentNotes: "Notes",
    placeholderAssignmentNotes: "Optional context for this assignment",

    removeTitle: "Remove assignment",
    removeQuestion: (model: string, period: string) =>
      `Remove this operator's assignment to ${model} (${period})?`,
    removeBody:
      "Ledger entries already posted from past periods are unaffected — they are append-only. This change is recorded in the audit log.",

    toastAssignmentCreated: "Assignment created",
    toastAssignmentUpdated: "Assignment updated",
    toastAssignmentRemoved: "Assignment removed",
    toastAssignmentCreateFailed: "Could not create assignment",
    toastAssignmentUpdateFailed: "Could not update assignment",
    toastAssignmentRemoveFailed: "Could not remove assignment",

    /* server actions */
    errEmail: "Enter a valid email address.",
    errPhoneLong: "Phone number is too long.",
    errCountry: "Use a 2-letter ISO country code.",
    errTelegramUsername: "A Telegram username is 5–32 letters, digits or underscores.",
    telegramLabel: "Telegram username",
    errDateInvalid: "Enter a valid date (YYYY-MM-DD).",
    errNotesLong: "Notes are too long.",
    errDisplayNameRequired: "Display name is required.",
    errLegalNameRequired: "Legal name is required.",
    errPoolShareType: "Enter a pool share.",
    errPoolShareMin: "Pool share can't be negative.",
    errPoolShareMax: "Pool share can't exceed 100%.",
    errModelRequired: "Choose a model.",
    errStartDateInvalid: "Enter a valid start date (YYYY-MM-DD).",
    errEndDateInvalid: "Enter a valid end date (YYYY-MM-DD).",
    errEndAfterStart: "End date must be after the start date.",
    errForm: "Please check the form and try again.",
    errDbCheck: "That doesn't satisfy a database rule — check the country code.",
    errDuplicate: "An operator with those details already exists.",
    errSaveFailed: "Could not save the operator. Please try again.",
    errGone: "That operator no longer exists.",
    errLoadFailed: "Could not load that operator.",
    errInvalidStatus: "Invalid status change.",
    errStatusFailed: "Could not change the status. Please try again.",
    errOverlap:
      "This operator already has an overlapping assignment to that model. Adjust the dates so the periods don't overlap.",
    errPoolExceeded:
      "The model's operator pool would exceed 100% for these dates. Lower this share or shorten the period.",
    errAssignmentCheck:
      "That doesn't satisfy a database rule — pool share must be 0–100% and the end date must follow the start date.",
    errAssignmentFk: "The operator or model no longer exists. Refresh and try again.",
    errAssignmentSaveFailed: "Could not save the assignment. Please try again.",
    errAssignmentInvalid: "Invalid assignment.",
    errAssignmentGone: "That assignment no longer exists.",
    errAssignmentRemoveFailed: "Could not remove the assignment. Please try again.",
    errNotAuthorizedAdd: "You are not authorized to add operators.",
    errNotAuthorizedEdit: "You are not authorized to edit operators.",
    errNotAuthorizedStatus: "You are not authorized to change operator status.",
    errNotAuthorizedAssign: "You are not authorized to assign operators.",
    errNotAuthorizedAssignEdit: "You are not authorized to edit assignments.",
    errNotAuthorizedAssignRemove: "You are not authorized to remove assignments.",
    msgAdded: (name: string) => `${name} added.`,
    msgUpdated: "Operator updated.",
    msgAlreadyStatus: (status: string) => `Operator is already ${status.toLowerCase()}.`,
    msgStatusChanged: (name: string, status: string) =>
      `${name} is now ${status.toLowerCase()}.`,
    msgAssignmentCreated: "Assignment created.",
    msgAssignmentUpdated: "Assignment updated.",
    msgAssignmentRemoved: "Assignment removed.",
  },

  /* ------------------------------------------------------------- platforms --- */

  platforms: {
    metaTitle: "Platforms",
    title: "Platforms",
    description:
      "The webcam platforms the studio works with, and each model's accounts on them.",

    statPlatforms: "Platforms",
    statPlatformsHint: "On record",
    statActivePlatforms: "Active platforms",
    statActivePlatformsHint: "Currently in use",
    statAccounts: "Accounts",
    statAccountsHint: "Across all models",
    statActiveAccounts: "Active accounts",
    statActiveAccountsHint: "Currently working",

    tabsAria: "Platforms sections",
    tabPlatforms: "Platforms",
    tabAccounts: "Accounts",
    platformsCardTitle: "Platforms",
    platformsCardDescription:
      "A platform can't be deleted once accounts reference it (docs/04 §4.5) — deactivate it instead.",
    accountsCardTitle: "Platform accounts",
    accountsCardDescription:
      "Every model's account across the studio's platforms. Usernames are unique per model and platform.",

    /* platforms table */
    platformsEmptyTitle: "No platforms yet",
    platformsEmptyDescription:
      "Add the webcam platforms the studio works with, then link model accounts.",
    colPlatform: "Platform",
    colWebsite: "Website",
    colAccounts: "Accounts",
    colStatus: "Status",
    activeToggleAria: "Toggle platform active state",
    toastPlatformToggled: "Platform updated",
    toastPlatformToggleFailed: "Could not change platform",

    /* accounts table */
    accountsEmptyTitle: "No platform accounts yet",
    accountsEmptyDescription: "Use “New account” to link a model to a platform.",
    colModel: "Model",
    colUsername: "Username",
    colPlatformFee: "Platform fee",
    accountStatusAria: "Change account status",
    toastAccountStatusChanged: "Status changed",
    toastAccountStatusFailed: "Could not change status",

    /* platform form */
    newPlatform: "New platform",
    platformCreateTitle: "Add a platform",
    platformEditTitle: "Edit platform",
    platformCreateDescription:
      "Reference record for a webcam platform the studio works with.",
    platformEditDescription: "Update this platform. Activation is toggled from the table.",
    platformSubmitCreate: "Add platform",
    platformSubmitEdit: "Save changes",
    fieldName: "Name",
    placeholderName: "e.g. Chaturbate",
    fieldWebsite: "Website",
    helpWebsite: "Optional. A scheme (https://) is added automatically if omitted.",
    placeholderWebsite: "platform.com",
    fieldPlatformStatus: "Status",
    helpPlatformStatus:
      "Inactive platforms stay on record but are flagged when picking accounts.",
    toastPlatformCreated: "Platform added",
    toastPlatformUpdated: "Platform updated",
    toastPlatformCreateFailed: "Could not add platform",
    toastPlatformUpdateFailed: "Could not update platform",

    /* account form */
    newAccount: "New account",
    accountCreateTitle: "Add a platform account",
    accountEditTitle: "Edit account",
    accountCreateDescription: "Link a model to one of the studio's platforms.",
    accountEditDescription: "Update this account's username and platform fee.",
    accountSubmitCreate: "Add account",
    accountSubmitEdit: "Save changes",
    fieldModel: "Model",
    selectModel: "Select a model…",
    fieldPlatform: "Platform",
    selectPlatform: "Select a platform…",
    helpPlatform: "Platforms with accounts can't be deleted (docs/04 §4.5).",
    inactiveSuffix: (name: string) => `${name} (inactive)`,
    fieldUsername: "Username",
    placeholderUsername: "On-platform handle",
    fieldFee: "Platform fee %",
    hintFee: "0–100%",
    helpFee: "The platform's revenue cut. Leave blank if unknown.",
    placeholderFee: "e.g. 20",
    fieldAccountStatus: "Status",
    helpAccountStatus: "Account lifecycle. Change it later from the accounts table.",
    toastAccountCreated: "Account added",
    toastAccountUpdated: "Account updated",
    toastAccountCreateFailed: "Could not add account",
    toastAccountUpdateFailed: "Could not update account",

    /* server actions */
    errUrl: "Enter a valid website URL.",
    errUrlLong: "That URL is too long.",
    errFeeType: "Enter a fee percentage.",
    errFeeMin: "Fee can't be negative.",
    errFeeMax: "Fee can't exceed 100%.",
    errNameRequired: "Platform name is required.",
    errUsernameRequired: "Username is required.",
    errModelRequired: "Choose a model.",
    errPlatformRequired: "Choose a platform.",
    errForm: "Please check the form and try again.",
    errPlatformDuplicate: "A platform with that name already exists.",
    errPlatformSaveFailed: "Could not save the platform. Please try again.",
    errPlatformGone: "That platform no longer exists.",
    errPlatformLoadFailed: "Could not load that platform.",
    errPlatformInvalid: "Invalid change.",
    errPlatformToggleFailed: "Could not change the platform. Please try again.",
    errAccountDuplicate:
      "That model already has an account with this username on this platform.",
    errAccountFk: "The selected model or platform no longer exists.",
    errAccountCheck:
      "That doesn't satisfy a database rule — check the platform fee (0–100%).",
    errAccountSaveFailed: "Could not save the account. Please try again.",
    errAccountGone: "That account no longer exists.",
    errAccountLoadFailed: "Could not load that account.",
    errAccountInvalidStatus: "Invalid status change.",
    errAccountStatusFailed: "Could not change the status. Please try again.",
    errNotAuthorizedAddPlatform: "You are not authorized to add platforms.",
    errNotAuthorizedEditPlatform: "You are not authorized to edit platforms.",
    errNotAuthorizedChangePlatform: "You are not authorized to change platforms.",
    errNotAuthorizedAddAccount: "You are not authorized to add platform accounts.",
    errNotAuthorizedEditAccount: "You are not authorized to edit platform accounts.",
    errNotAuthorizedAccountStatus: "You are not authorized to change account status.",
    msgPlatformAdded: (name: string) => `${name} added.`,
    msgPlatformUpdated: "Platform updated.",
    msgPlatformAlready: (isActive: boolean) =>
      `Platform is already ${isActive ? "active" : "inactive"}.`,
    msgPlatformNow: (name: string, isActive: boolean) =>
      `${name} is now ${isActive ? "active" : "inactive"}.`,
    msgAccountAdded: (username: string) => `Account ${username} added.`,
    msgAccountUpdated: "Account updated.",
    msgAccountAlready: (status: string) => `Account is already ${status.toLowerCase()}.`,
    msgAccountNow: (username: string, status: string) =>
      `${username} is now ${status.toLowerCase()}.`,
  },

  /* -------------------------------------------------------------- sessions --- */

  sessions: {
    metaTitle: "Sessions",
    title: "Sessions",
    description:
      "Time tracking — the hours source of truth. Log when a model worked an account; the database computes each session's duration.",

    noModelsTitle: "No models yet",
    noModelsDescription:
      "Sessions are logged against a model's platform account. Add a model and a platform account first, then come back to track hours.",

    statSessions: "Sessions",
    statHours: "Hours logged",
    statHoursHint: "Sum of durations",
    statOpen: "Open sessions",
    statOpenHint: "No end time yet",
    statGross: "Gross logged",
    statGrossHint: "Per-session; Earnings is money truth",
    scopeAll: "All models",
    scopeFiltered: "Filtered model",

    filterLabel: "Filter",
    filterAria: "Filter sessions by model",
    allModels: "All models",
    shown: (n: number) => `${n} shown`,

    /** Fallbacks used when building an account label server-side. */
    platformFallback: "Platform",
    unknownModel: "Unknown model",
    unknownAccount: "Unknown account",

    emptyTitle: "No sessions to show",
    emptyDescription:
      "No work sessions match this view. Log one, or clear the model filter to see the full list.",
    colModel: "Model",
    colAccount: "Account",
    colStarted: "Started",
    colEnded: "Ended",
    colDuration: "Duration",
    colGross: "Gross",
    badgeOpen: "Open",

    deleteTitle: "Delete session?",
    deleteDescription: (label: string) =>
      `This permanently removes the session for ${label}. This can't be undone.`,
    deleteBody:
      "Deleting a session removes its recorded hours. Money statements in Earnings are unaffected.",
    deleteConfirm: "Delete session",
    toastDeleted: "Session deleted",
    toastDeleteFailed: "Could not delete session",

    /* form */
    logSession: "Log session",
    createTitle: "Log a work session",
    editTitle: "Edit session",
    dialogDescription:
      "Sessions are the hours source of truth (docs/04 §4.6). Leave the end time blank to start an open session; duration is computed by the database.",
    submitCreate: "Log session",
    submitEdit: "Save changes",
    noAccounts:
      "No platform accounts exist yet. Add a model and a platform account first — sessions are always tied to an account.",
    fieldModel: "Model",
    helpModel: "Scopes which accounts you can pick below.",
    selectModel: "Select a model…",
    fieldAccount: "Platform account",
    helpNoAccounts: "This model has no platform accounts yet.",
    selectAccount: "Select an account…",
    chooseModelFirst: "Choose a model first",
    fieldStartedAt: "Started at",
    helpStartedAt: "Interpreted as UTC, matching how times display across the app.",
    fieldEndedAt: "Ended at",
    helpDuration: (formatted: string) => `Duration: ${formatted}`,
    helpOpenSession: "Blank = open session (still running).",
    fieldGross: "Gross earnings",
    hintGross: "≥ 0",
    helpGross: "Per-session earnings when known. The money source of truth is Earnings.",
    fieldCurrency: "Currency",
    helpCurrency: "3-letter code, e.g. USD.",
    fieldNotes: "Notes",
    helpNotes: "Internal only — never shown in self-service views.",
    placeholderNotes: "Anything worth recording about this session",
    toastCreated: "Session logged",
    toastUpdated: "Session updated",
    toastCreateFailed: "Could not log session",
    toastUpdateFailed: "Could not update session",

    /* server actions */
    errDatetime: "Enter a valid date and time.",
    errGrossType: "Enter the gross earnings.",
    errGrossMin: "Gross earnings can't be negative.",
    errAmountTooLarge: "That amount is too large.",
    errCurrency: "Use a 3-letter currency code, e.g. USD.",
    errNotesLong: "Notes are too long.",
    errAccountRequired: "Choose a platform account.",
    errForm: "Please check the form and try again.",
    errDbCheck:
      "That doesn't satisfy a database rule — the end time must be after the start time and gross earnings can't be negative.",
    errAccountFk: "That platform account no longer exists. Refresh and try again.",
    errSaveFailed: "Could not save the session. Please try again.",
    errVerifyAccount: "Could not verify the platform account. Please try again.",
    errStartInvalid: "Enter a valid start date and time.",
    errEndInvalid: "Enter a valid end date and time.",
    errEndAfterStart: "The end time must be after the start time.",
    errGone: "That session no longer exists.",
    errInvalid: "Invalid session.",
    errDeleteFailed: "Could not delete the session. Please try again.",
    errNotAuthorizedLog: "You are not authorized to log sessions.",
    errNotAuthorizedEdit: "You are not authorized to edit sessions.",
    errNotAuthorizedDelete: "You are not authorized to delete sessions.",
    msgLogged: "Session logged.",
    msgOpenStarted: "Open session started.",
    msgUpdated: "Session updated.",
    msgDeleted: "Session deleted.",
  },

  /* -------------------------------------------------------------- earnings --- */

  earnings: {
    metaTitle: "Earnings",
    title: "Earnings",
    description:
      "Money tracking — the source of truth. Record one statement per platform account per period; net is the input to the commission split.",

    noModelsTitle: "No models yet",
    noModelsDescription:
      "Earnings statements are recorded against a model's platform account. Add a model and a platform account first, then come back to record statements.",

    statStatements: "Statements",
    statGross: "Gross",
    statGrossHint: "Billed by platforms",
    statFees: "Platform fees",
    statFeesHint: "Platforms' cut",
    statNet: "Net received",
    statNetHint: "Split input (docs/09)",
    scopeAll: "All models",
    scopeFiltered: "Filtered model",

    filterLabel: "Filter",
    filterAria: "Filter earnings by model",
    allModels: "All models",
    shown: (n: number) => `${n} shown`,

    platformFallback: "Platform",
    unknownModel: "Unknown model",
    unknownAccount: "Unknown account",

    emptyTitle: "No statements to show",
    emptyDescription:
      "No earnings statements match this view. Record one, or clear the model filter to see the full list.",
    colModel: "Model",
    colAccount: "Account",
    colPeriod: "Period",
    colGross: "Gross",
    colFee: "Platform fee",
    colNet: "Net",

    deleteTitle: "Delete statement?",
    deleteDescription: (label: string) =>
      `This permanently removes the earnings statement for ${label}. This can't be undone.`,
    deleteBody:
      "Earnings are the money source of truth. Deleting a statement removes it from the split inputs; already-posted ledger entries are unaffected.",
    deleteConfirm: "Delete statement",
    toastDeleted: "Statement deleted",
    toastDeleteFailed: "Could not delete statement",

    /* form */
    recordStatement: "Record statement",
    createTitle: "Record an earnings statement",
    editTitle: "Edit statement",
    dialogDescription:
      "Earnings are the money source of truth (docs/04 §4.7): one row per account per statement period. Net is what the studio received — the input to the commission split.",
    submitCreate: "Record statement",
    submitEdit: "Save changes",
    noAccounts:
      "No platform accounts exist yet. Add a model and a platform account first — every statement belongs to an account.",
    fieldModel: "Model",
    helpModel: "Scopes which accounts you can pick below.",
    selectModel: "Select a model…",
    fieldAccount: "Platform account",
    helpFeePrefill: (percentFormatted: string) =>
      `Platform fee ${percentFormatted} — used to pre-fill the fee.`,
    helpNoAccounts: "This model has no platform accounts yet.",
    selectAccount: "Select an account…",
    chooseModelFirst: "Choose a model first",
    fieldPeriodStart: "Period start",
    fieldPeriodEnd: "Period end",
    fieldGross: "Gross",
    hintAmount: "≥ 0",
    helpGross: "Total billed by the platform.",
    fieldFee: "Platform fee",
    helpFee: "The platform's cut.",
    fieldNet: "Net",
    helpNet: "What the studio received.",
    fieldCurrency: "Currency",
    helpCurrency: "3-letter code, e.g. USD.",
    netPreview: "Net received:",
    toastCreated: "Statement recorded",
    toastUpdated: "Statement updated",
    toastCreateFailed: "Could not record statement",
    toastUpdateFailed: "Could not update statement",

    /* server actions */
    errDateInvalid: "Enter a valid date (YYYY-MM-DD).",
    errAmountType: "Enter an amount.",
    errAmountMin: "Amount can't be negative.",
    errAmountTooLarge: "That amount is too large.",
    errCurrency: "Use a 3-letter currency code, e.g. USD.",
    errAccountRequired: "Choose a platform account.",
    errPeriodOrder: "The period end must be on or after the period start.",
    errForm: "Please check the form and try again.",
    errDuplicate:
      "A statement already exists for this account and period. Each platform account can have only one earnings row per statement period — edit the existing one instead.",
    errDbCheck:
      "That doesn't satisfy a database rule — the period end must be on or after the start, and amounts can't be negative.",
    errAccountFk: "That platform account no longer exists. Refresh and try again.",
    errSaveFailed: "Could not save the earnings statement. Please try again.",
    errVerifyAccount: "Could not verify the platform account. Please try again.",
    errGone: "That statement no longer exists.",
    errInvalid: "Invalid statement.",
    errDeleteFailed: "Could not delete the statement. Please try again.",
    errNotAuthorizedRecord: "You are not authorized to record earnings.",
    errNotAuthorizedEdit: "You are not authorized to edit earnings.",
    errNotAuthorizedDelete: "You are not authorized to delete earnings.",
    msgRecorded: "Statement recorded.",
    msgUpdated: "Statement updated.",
    msgDeleted: "Statement deleted.",
  },
};

export const studioRu: typeof studioEn = {
  /* ------------------------------------------------------------ enum labels --- */

  /**
   * Short predicative forms: one map has to describe both «модель» (feminine)
   * and «оператор» (masculine), and «Активен» reads as a state of the record
   * rather than as an adjective agreeing with the person.
   */
  /** Кто человек в группе — переменные вокруг модели. */
  staffRole: {
    operator: "Оператор",
    coach: "Коуч",
    team_leader: "Тимлид",
  },
  staffRoleLabel: "Роль в группе",
  staffRoleHelp: "Операторы ведут переписку, коучи развивают модель, тимлиды руководят группой. Все трое делят общий пул команды.",
  groupTitle: "Группа",
  groupDescription: "Модель — постоянная величина. Операторы, коучи и тимлиды — переменные: назначьте столько, сколько нужно этой модели.",
  groupModel: "Модель",
  groupTeam: "Команда",
  groupEmpty: "Никто не назначен. Вся командная доля этой модели остаётся у студии.",
  groupPoolNote: (percent: string) => `Пул команды — ${percent} от чистого дохода, делится по весам ниже.`,
  groupUnallocated: (percent: string) => `${percent} пула не распределено и остаётся у студии.`,
  lifecycleStatus: {
    active: "Активен",
    inactive: "Неактивен",
    on_leave: "В отпуске",
    terminated: "Завершён",
  },

  accountStatus: {
    active: "Активен",
    suspended: "Приостановлен",
    closed: "Закрыт",
  },

  platformActive: {
    active: "Активна",
    inactive: "Неактивна",
  },

  assignmentActivity: {
    active: "Действует",
    upcoming: "Предстоит",
    ended: "Завершено",
  },

  /* ---------------------------------------------------------------- models --- */

  models: {
    metaTitle: "Модели",
    title: "Модели",
    description:
      "Деловая карточка каждой модели. Добавьте модель, затем свяжите с ней аккаунты площадок, доходы и документы соответствия.",

    statTotal: "Всего",
    statTotalHint: "Все записи реестра",
    statActive: "Активные",
    statActiveHint: "Сейчас работают",
    statOnLeave: "В отпуске",
    statOnLeaveHint: "Временно приостановлены",
    statTerminated: "Завершённые",
    statTerminatedHint: "Сотрудничество окончено",

    filterLabel: "Фильтр",
    filterAria: "Фильтр моделей по статусу",
    allStatuses: "Все статусы",
    shown: (shown: number, total: number) => `Показано ${shown} из ${total}`,

    emptyTitle: "Модели не найдены",
    emptyDescription:
      "Ни одна модель не подходит под этот фильтр. Добавьте модель или сбросьте фильтр статуса, чтобы увидеть весь список.",
    colModel: "Модель",
    colCountry: "Страна",
    colStartDate: "Дата начала",
    colCommission: "Комиссия",
    colStatus: "Статус",

    /* form */
    newModel: "Новая модель",
    createTitle: "Добавить модель",
    editTitle: "Изменить модель",
    createDescription:
      "Создайте деловую карточку. Личный кабинет можно привязать позже через приглашение.",
    editDescription:
      "Обновите профиль модели. Статус меняется в шапке страницы.",
    submitCreate: "Добавить модель",
    submitEdit: "Сохранить изменения",

    fieldStageName: "Сценический псевдоним",
    placeholderStageName: "Публичное рабочее имя",
    fieldLegalName: "Юридическое имя",
    placeholderLegalName: "Полное юридическое имя",
    helpLegalName: "Конфиденциально — видно только супер-админам и менеджерам.",
    fieldDob: "Дата рождения",
    helpDob: "Не моложе 18 лет — проверяется базой данных.",
    fieldCommission: "Комиссия, %",
    hintCommission: "0–100%",
    helpCommission:
      "Устаревшая доля студии по умолчанию, заменена схемами комиссий.",
    fieldEmail: "Email",
    placeholderEmail: "model@example.com",
    fieldPhone: "Телефон",
    placeholderPhone: "Необязательно",
    fieldCountry: "Страна",
    helpCountry: "ISO 3166-1 alpha-2, например US, GB.",
    fieldStartDate: "Дата начала",
    fieldStatus: "Статус",
    helpStatus: "Текущий статус. Позже его можно изменить на странице модели.",
    fieldNotes: "Заметки",
    helpNotes: "Только для внутреннего пользования — модель их не видит.",
    placeholderNotes: "Всё, что важно знать команде",

    toastCreated: "Модель добавлена",
    toastUpdated: "Модель обновлена",
    toastCreateFailed: "Не удалось добавить модель",
    toastUpdateFailed: "Не удалось обновить модель",
    toastStatusChanged: "Статус изменён",
    toastStatusFailed: "Не удалось изменить статус",
    statusControlLabel: "Статус",
    statusControlAria: "Изменить статус модели",

    /* detail */
    detailMetaFallback: "Модель",
    tabsAria: "Разделы карточки модели",
    tabProfile: "Профиль",
    tabAccounts: "Аккаунты площадок",
    tabEarnings: "Последние доходы",
    tabCompliance: "Документы и соответствие",

    profileTitle: "Профиль",
    profileDescription:
      "Деловая карточка. Конфиденциальные поля видны только супер-админам и менеджерам.",
    rowStageName: "Сценический псевдоним",
    rowLegalName: "Юридическое имя",
    rowDob: "Дата рождения",
    rowCountry: "Страна",
    rowStartDate: "Дата начала",
    rowStatus: "Статус",
    rowCommissionLegacy: "Комиссия (устаревшая)",
    rowEmail: "Email",
    rowPhone: "Телефон",
    rowSelfService: "Личный кабинет",
    linked: "Привязан",
    notLinked: "Не привязан",
    rowCreated: "Создана",
    notesHeading: "Заметки",
    sensitive: "Конфиденциально",

    accountsTitle: "Аккаунты площадок",
    accountsDescription: "Аккаунты этой модели на площадках студии.",
    accountsEmptyTitle: "Аккаунтов площадок нет",
    accountsEmptyDescription: "Аккаунты площадок ведутся в разделе «Площадки».",
    colPlatform: "Площадка",
    colUsername: "Логин",
    colPlatformFee: "Комиссия площадки",

    earningsTitle: "Последние доходы",
    earningsDescription:
      "10 последних отчётных периодов. Доходы — источник истины по деньгам (docs/04 §4.7).",
    earningsEmptyTitle: "Доходы не внесены",
    earningsEmptyDescription: "Отчётные периоды вносятся в разделе «Доходы».",
    colPeriod: "Период",
    colAccount: "Аккаунт",
    colGross: "Брутто",
    colNet: "Нетто",

    statDocuments: "Документы",
    statDocumentsHint: (n: number) =>
      `${n} ${plural("ru", n, { one: "активный", few: "активных", many: "активных" })}`,
    statValid: "Действительны",
    statValidHint: "Срок не истекает в ближайшее время",
    statExpiring: "Истекают",
    statExpiringHint: "В течение 30 дней",
    statExpired: "Просрочены",
    statExpiredHint: "Срок истёк",
    complianceTitle: "Статус соответствия",
    complianceDescription:
      "Рассчитывается по срокам действия документов (docs/07). Сами документы — в разделе «Документы».",
    complianceEmptyTitle: "Документов нет",
    complianceEmptyDescription:
      "Документы, удостоверяющие личность, и документы соответствия загружаются в разделе «Документы».",
    complianceExpired: (n: number) =>
      `${n} ${plural("ru", n, { one: "документ просрочен", few: "документа просрочены", many: "документов просрочены" })}. Их нужно продлить, чтобы модель соответствовала требованиям.`,
    complianceExpiring: (n: number) =>
      `${n} ${plural("ru", n, { one: "документ истекает", few: "документа истекают", many: "документов истекают" })} в течение 30 дней. Запланируйте продление.`,
    complianceAllValid: "Все документы действительны.",

    /* server actions */
    errDobInvalid: "Укажите корректную дату рождения (ГГГГ-ММ-ДД).",
    errAdult: "Модель должна быть не моложе 18 лет.",
    errDateInvalid: "Укажите корректную дату (ГГГГ-ММ-ДД).",
    errEmail: "Укажите корректный email.",
    errPhoneLong: "Номер телефона слишком длинный.",
    errCountry: "Используйте двухбуквенный код страны ISO.",
    errTelegramUsername: "Юзернейм Telegram — 5–32 символа: буквы, цифры, подчёркивание.",
    telegramLabel: "Юзернейм Telegram",
    errNotesLong: "Заметки слишком длинные.",
    errCommissionType: "Укажите процент комиссии.",
    errCommissionMin: "Комиссия не может быть отрицательной.",
    errCommissionMax: "Комиссия не может превышать 100%.",
    errStageNameRequired: "Укажите сценический псевдоним.",
    errLegalNameRequired: "Укажите юридическое имя.",
    errForm: "Проверьте форму и попробуйте ещё раз.",
    errDbCheck:
      "Не выполнено правило базы данных — проверьте дату рождения (18+) и комиссию (0–100%).",
    errDuplicate: "Модель с такими данными уже существует.",
    errSaveFailed: "Не удалось сохранить модель. Попробуйте ещё раз.",
    errGone: "Этой модели больше нет.",
    errLoadFailed: "Не удалось загрузить эту модель.",
    errInvalidStatus: "Недопустимое изменение статуса.",
    errStatusFailed: "Не удалось изменить статус. Попробуйте ещё раз.",
    errNotAuthorizedAdd: "У вас нет прав добавлять моделей.",
    errNotAuthorizedEdit: "У вас нет прав изменять моделей.",
    errNotAuthorizedStatus: "У вас нет прав менять статус модели.",
    msgAdded: (name: string) => `${name} — модель добавлена.`,
    msgUpdated: "Модель обновлена.",
    msgAlreadyStatus: (status: string) => `У модели уже статус «${status}».`,
    msgStatusChanged: (name: string, status: string) =>
      `${name} — новый статус: «${status}».`,
  },

  /* ------------------------------------------------------------- operators --- */

  operators: {
    metaTitle: "Операторы",
    title: "Операторы",
    description:
      "Сотрудники поддержки, которые получают долю дохода модели. Назначьте оператора на модель с долей пула и периодом.",

    statOperators: "Операторы",
    statOperatorsHint: "Всего деловых карточек",
    statActive: "Активные",
    statActiveHint: "Текущий статус",
    statAssigned: "С назначениями",
    statAssignedHint: "Есть действующее назначение на модель",

    emptyTitle: "Операторов пока нет",
    emptyDescription:
      "Добавьте первого оператора, чтобы назначать его на моделей и начислять ему долю операторского пула.",
    colOperator: "Оператор",
    colStatus: "Статус",
    colAssignments: "Назначения",
    colCountry: "Страна",
    colStarted: "Начало работы",
    loginLinked: "Логин привязан",
    activeCount: (n: number) =>
      `(${n} ${plural("ru", n, { one: "активное", few: "активных", many: "активных" })})`,

    /* form */
    newOperator: "Новый оператор",
    createTitle: "Добавить оператора",
    editTitle: "Изменить оператора",
    createDescription:
      "Создайте деловую карточку. Личный кабинет можно привязать позже через приглашение.",
    editDescription: "Обновите профиль оператора. Статус меняется в шапке страницы.",
    submitCreate: "Добавить оператора",
    submitEdit: "Сохранить изменения",

    fieldDisplayName: "Отображаемое имя",
    placeholderDisplayName: "Рабочее имя",
    fieldLegalName: "Юридическое имя",
    placeholderLegalName: "Полное юридическое имя",
    helpLegalName: "Конфиденциально — видно только супер-админам и менеджерам.",
    fieldEmail: "Email",
    placeholderEmail: "operator@example.com",
    fieldPhone: "Телефон",
    placeholderPhone: "Необязательно",
    fieldCountry: "Страна",
    helpCountry: "ISO 3166-1 alpha-2, например US, GB.",
    fieldStartDate: "Дата начала",
    fieldStatus: "Статус",
    helpStatus: "Текущий статус. Позже его можно изменить на странице оператора.",
    fieldNotes: "Заметки",
    helpNotes: "Только для внутреннего пользования — оператор их не видит.",
    placeholderNotes: "Всё, что важно знать команде",

    toastCreated: "Оператор добавлен",
    toastUpdated: "Оператор обновлён",
    toastCreateFailed: "Не удалось добавить оператора",
    toastUpdateFailed: "Не удалось обновить оператора",

    /* status control */
    changeStatus: "Изменить статус",
    statusDialogTitle: "Изменить статус",
    statusDialogDescription: "Изменения статуса фиксируются в журнале действий.",
    helpStatusDialog:
      "У завершивших работу операторов сохраняется история назначений — её нельзя удалить.",
    toastStatusChanged: "Статус обновлён",
    toastStatusFailed: "Не удалось изменить статус",

    /* detail */
    detailMetaTitle: "Оператор",
    detailDescription:
      "Деловая карточка оператора, назначения на моделей и доли пула.",
    profileTitle: "Профиль",
    profileDescription:
      "Конфиденциальные поля видны только супер-админам и менеджерам.",
    rowLegalName: "Юридическое имя",
    rowEmail: "Email",
    rowPhone: "Телефон",
    rowCountry: "Страна",
    rowStartDate: "Дата начала",
    rowSelfService: "Личный кабинет",
    linked: "Привязан",
    notLinked: "Не привязан",
    rowCreated: "Создан",
    rowNotes: "Заметки",
    unknownModel: "Неизвестная модель",

    /* assignments */
    assignmentsTitle: "Назначения",
    assignmentsDescription:
      "Модели, которые ведёт этот оператор, его доля пула и период действия.",
    newAssignment: "Новое назначение",
    assignmentsEmptyTitle: "Назначений пока нет",
    assignmentsEmptyNoModels:
      "Сначала создайте модель, затем назначьте на неё этого оператора.",
    assignmentsEmptyDescription:
      "Назначьте оператора на модель, чтобы начислять ему долю её операторского пула.",
    colModel: "Модель",
    colPoolShare: "Доля пула",
    colPeriod: "Период",
    colState: "Состояние",
    openEnded: "(бессрочно)",
    remove: "Удалить",

    assignmentCreateTitle: "Новое назначение",
    assignmentEditTitle: "Изменить назначение",
    assignmentDialogDescription:
      "Операторский пул модели не может превышать 100%, а периоды по одной модели не могут пересекаться — и то и другое проверяет база данных.",
    assignmentSubmitCreate: "Создать назначение",
    assignmentSubmitEdit: "Сохранить изменения",
    fieldModel: "Модель",
    helpModel: "Модель, которую ведёт этот оператор.",
    selectModel: "Выберите модель…",
    fieldPoolShare: "Доля пула, %",
    hintPoolShare: "0–100%",
    helpPoolShare:
      "Доля этого оператора в операторском пуле модели. Сумма долей всех операторов по одной модели не должна превышать 100%.",
    fieldAssignedFrom: "Назначен с",
    fieldAssignedTo: "Назначен по",
    helpAssignedTo: "Оставьте поле пустым для бессрочного назначения.",
    fieldAssignmentNotes: "Заметки",
    placeholderAssignmentNotes: "Необязательный комментарий к назначению",

    removeTitle: "Удалить назначение",
    removeQuestion: (model: string, period: string) =>
      `Удалить назначение этого оператора на модель ${model} (${period})?`,
    removeBody:
      "Уже проведённые операции реестра за прошлые периоды не изменятся — реестр только пополняется. Это изменение фиксируется в журнале действий.",

    toastAssignmentCreated: "Назначение создано",
    toastAssignmentUpdated: "Назначение обновлено",
    toastAssignmentRemoved: "Назначение удалено",
    toastAssignmentCreateFailed: "Не удалось создать назначение",
    toastAssignmentUpdateFailed: "Не удалось обновить назначение",
    toastAssignmentRemoveFailed: "Не удалось удалить назначение",

    /* server actions */
    errEmail: "Укажите корректный email.",
    errPhoneLong: "Номер телефона слишком длинный.",
    errCountry: "Используйте двухбуквенный код страны ISO.",
    errTelegramUsername: "Юзернейм Telegram — 5–32 символа: буквы, цифры, подчёркивание.",
    telegramLabel: "Юзернейм Telegram",
    errDateInvalid: "Укажите корректную дату (ГГГГ-ММ-ДД).",
    errNotesLong: "Заметки слишком длинные.",
    errDisplayNameRequired: "Укажите отображаемое имя.",
    errLegalNameRequired: "Укажите юридическое имя.",
    errPoolShareType: "Укажите долю пула.",
    errPoolShareMin: "Доля пула не может быть отрицательной.",
    errPoolShareMax: "Доля пула не может превышать 100%.",
    errModelRequired: "Выберите модель.",
    errStartDateInvalid: "Укажите корректную дату начала (ГГГГ-ММ-ДД).",
    errEndDateInvalid: "Укажите корректную дату окончания (ГГГГ-ММ-ДД).",
    errEndAfterStart: "Дата окончания должна быть позже даты начала.",
    errForm: "Проверьте форму и попробуйте ещё раз.",
    errDbCheck: "Не выполнено правило базы данных — проверьте код страны.",
    errDuplicate: "Оператор с такими данными уже существует.",
    errSaveFailed: "Не удалось сохранить оператора. Попробуйте ещё раз.",
    errGone: "Этого оператора больше нет.",
    errLoadFailed: "Не удалось загрузить этого оператора.",
    errInvalidStatus: "Недопустимое изменение статуса.",
    errStatusFailed: "Не удалось изменить статус. Попробуйте ещё раз.",
    errOverlap:
      "У этого оператора уже есть пересекающееся назначение на эту модель. Измените даты так, чтобы периоды не пересекались.",
    errPoolExceeded:
      "Операторский пул модели превысит 100% в эти даты. Уменьшите долю или сократите период.",
    errAssignmentCheck:
      "Не выполнено правило базы данных — доля пула должна быть в пределах 0–100%, а дата окончания — позже даты начала.",
    errAssignmentFk:
      "Оператора или модели больше нет. Обновите страницу и попробуйте снова.",
    errAssignmentSaveFailed: "Не удалось сохранить назначение. Попробуйте ещё раз.",
    errAssignmentInvalid: "Некорректное назначение.",
    errAssignmentGone: "Этого назначения больше нет.",
    errAssignmentRemoveFailed: "Не удалось удалить назначение. Попробуйте ещё раз.",
    errNotAuthorizedAdd: "У вас нет прав добавлять операторов.",
    errNotAuthorizedEdit: "У вас нет прав изменять операторов.",
    errNotAuthorizedStatus: "У вас нет прав менять статус оператора.",
    errNotAuthorizedAssign: "У вас нет прав назначать операторов.",
    errNotAuthorizedAssignEdit: "У вас нет прав изменять назначения.",
    errNotAuthorizedAssignRemove: "У вас нет прав удалять назначения.",
    msgAdded: (name: string) => `${name} — оператор добавлен.`,
    msgUpdated: "Оператор обновлён.",
    msgAlreadyStatus: (status: string) => `У оператора уже статус «${status}».`,
    msgStatusChanged: (name: string, status: string) =>
      `${name} — новый статус: «${status}».`,
    msgAssignmentCreated: "Назначение создано.",
    msgAssignmentUpdated: "Назначение обновлено.",
    msgAssignmentRemoved: "Назначение удалено.",
  },

  /* ------------------------------------------------------------- platforms --- */

  platforms: {
    metaTitle: "Площадки",
    title: "Площадки",
    description:
      "Площадки, с которыми работает студия, и аккаунты моделей на них.",

    statPlatforms: "Площадки",
    statPlatformsHint: "Всего на учёте",
    statActivePlatforms: "Активные площадки",
    statActivePlatformsHint: "Используются сейчас",
    statAccounts: "Аккаунты",
    statAccountsHint: "По всем моделям",
    statActiveAccounts: "Активные аккаунты",
    statActiveAccountsHint: "Работают сейчас",

    tabsAria: "Разделы площадок",
    tabPlatforms: "Площадки",
    tabAccounts: "Аккаунты",
    platformsCardTitle: "Площадки",
    platformsCardDescription:
      "Площадку нельзя удалить, если на неё ссылаются аккаунты (docs/04 §4.5) — вместо этого сделайте её неактивной.",
    accountsCardTitle: "Аккаунты площадок",
    accountsCardDescription:
      "Аккаунты всех моделей на площадках студии. Логин уникален в пределах модели и площадки.",

    /* platforms table */
    platformsEmptyTitle: "Площадок пока нет",
    platformsEmptyDescription:
      "Добавьте площадки, с которыми работает студия, затем свяжите с ними аккаунты моделей.",
    colPlatform: "Площадка",
    colWebsite: "Сайт",
    colAccounts: "Аккаунты",
    colStatus: "Статус",
    activeToggleAria: "Переключить активность площадки",
    toastPlatformToggled: "Площадка обновлена",
    toastPlatformToggleFailed: "Не удалось изменить площадку",

    /* accounts table */
    accountsEmptyTitle: "Аккаунтов площадок пока нет",
    accountsEmptyDescription:
      "Нажмите «Новый аккаунт», чтобы связать модель с площадкой.",
    colModel: "Модель",
    colUsername: "Логин",
    colPlatformFee: "Комиссия площадки",
    accountStatusAria: "Изменить статус аккаунта",
    toastAccountStatusChanged: "Статус изменён",
    toastAccountStatusFailed: "Не удалось изменить статус",

    /* platform form */
    newPlatform: "Новая площадка",
    platformCreateTitle: "Добавить площадку",
    platformEditTitle: "Изменить площадку",
    platformCreateDescription:
      "Справочная запись о площадке, с которой работает студия.",
    platformEditDescription:
      "Обновите площадку. Активность переключается в таблице.",
    platformSubmitCreate: "Добавить площадку",
    platformSubmitEdit: "Сохранить изменения",
    fieldName: "Название",
    placeholderName: "Например, Chaturbate",
    fieldWebsite: "Сайт",
    helpWebsite: "Необязательно. Схема (https://) подставляется автоматически.",
    placeholderWebsite: "platform.com",
    fieldPlatformStatus: "Статус",
    helpPlatformStatus:
      "Неактивные площадки остаются на учёте, но помечаются при выборе аккаунта.",
    toastPlatformCreated: "Площадка добавлена",
    toastPlatformUpdated: "Площадка обновлена",
    toastPlatformCreateFailed: "Не удалось добавить площадку",
    toastPlatformUpdateFailed: "Не удалось обновить площадку",

    /* account form */
    newAccount: "Новый аккаунт",
    accountCreateTitle: "Добавить аккаунт площадки",
    accountEditTitle: "Изменить аккаунт",
    accountCreateDescription: "Свяжите модель с одной из площадок студии.",
    accountEditDescription: "Обновите логин и комиссию площадки для этого аккаунта.",
    accountSubmitCreate: "Добавить аккаунт",
    accountSubmitEdit: "Сохранить изменения",
    fieldModel: "Модель",
    selectModel: "Выберите модель…",
    fieldPlatform: "Площадка",
    selectPlatform: "Выберите площадку…",
    helpPlatform: "Площадки с аккаунтами удалить нельзя (docs/04 §4.5).",
    inactiveSuffix: (name: string) => `${name} (неактивна)`,
    fieldUsername: "Логин",
    placeholderUsername: "Логин на площадке",
    fieldFee: "Комиссия площадки, %",
    hintFee: "0–100%",
    helpFee: "Доля площадки в доходе. Оставьте пустым, если неизвестна.",
    placeholderFee: "например, 20",
    fieldAccountStatus: "Статус",
    helpAccountStatus:
      "Статус аккаунта. Позже его можно изменить в таблице аккаунтов.",
    toastAccountCreated: "Аккаунт добавлен",
    toastAccountUpdated: "Аккаунт обновлён",
    toastAccountCreateFailed: "Не удалось добавить аккаунт",
    toastAccountUpdateFailed: "Не удалось обновить аккаунт",

    /* server actions */
    errUrl: "Укажите корректный адрес сайта.",
    errUrlLong: "Этот адрес слишком длинный.",
    errFeeType: "Укажите процент комиссии.",
    errFeeMin: "Комиссия не может быть отрицательной.",
    errFeeMax: "Комиссия не может превышать 100%.",
    errNameRequired: "Укажите название площадки.",
    errUsernameRequired: "Укажите логин.",
    errModelRequired: "Выберите модель.",
    errPlatformRequired: "Выберите площадку.",
    errForm: "Проверьте форму и попробуйте ещё раз.",
    errPlatformDuplicate: "Площадка с таким названием уже существует.",
    errPlatformSaveFailed: "Не удалось сохранить площадку. Попробуйте ещё раз.",
    errPlatformGone: "Этой площадки больше нет.",
    errPlatformLoadFailed: "Не удалось загрузить эту площадку.",
    errPlatformInvalid: "Недопустимое изменение.",
    errPlatformToggleFailed: "Не удалось изменить площадку. Попробуйте ещё раз.",
    errAccountDuplicate:
      "У этой модели уже есть аккаунт с таким логином на этой площадке.",
    errAccountFk: "Выбранной модели или площадки больше нет.",
    errAccountCheck:
      "Не выполнено правило базы данных — проверьте комиссию площадки (0–100%).",
    errAccountSaveFailed: "Не удалось сохранить аккаунт. Попробуйте ещё раз.",
    errAccountGone: "Этого аккаунта больше нет.",
    errAccountLoadFailed: "Не удалось загрузить этот аккаунт.",
    errAccountInvalidStatus: "Недопустимое изменение статуса.",
    errAccountStatusFailed: "Не удалось изменить статус. Попробуйте ещё раз.",
    errNotAuthorizedAddPlatform: "У вас нет прав добавлять площадки.",
    errNotAuthorizedEditPlatform: "У вас нет прав изменять площадки.",
    errNotAuthorizedChangePlatform: "У вас нет прав изменять площадки.",
    errNotAuthorizedAddAccount: "У вас нет прав добавлять аккаунты площадок.",
    errNotAuthorizedEditAccount: "У вас нет прав изменять аккаунты площадок.",
    errNotAuthorizedAccountStatus: "У вас нет прав менять статус аккаунта.",
    msgPlatformAdded: (name: string) => `${name} — площадка добавлена.`,
    msgPlatformUpdated: "Площадка обновлена.",
    msgPlatformAlready: (isActive: boolean) =>
      `Площадка уже ${isActive ? "активна" : "неактивна"}.`,
    msgPlatformNow: (name: string, isActive: boolean) =>
      `${name} — теперь ${isActive ? "активна" : "неактивна"}.`,
    msgAccountAdded: (username: string) => `Аккаунт ${username} добавлен.`,
    msgAccountUpdated: "Аккаунт обновлён.",
    msgAccountAlready: (status: string) => `У аккаунта уже статус «${status}».`,
    msgAccountNow: (username: string, status: string) =>
      `${username} — новый статус: «${status}».`,
  },

  /* -------------------------------------------------------------- sessions --- */

  sessions: {
    metaTitle: "Рабочие смены",
    title: "Рабочие смены",
    description:
      "Учёт времени — источник истины по часам. Отметьте, когда модель работала на аккаунте; длительность смены рассчитывает база данных.",

    noModelsTitle: "Моделей пока нет",
    noModelsDescription:
      "Смены записываются на аккаунт площадки конкретной модели. Сначала добавьте модель и аккаунт площадки, затем вернитесь к учёту часов.",

    statSessions: "Смены",
    statHours: "Учтено часов",
    statHoursHint: "Сумма длительностей",
    statOpen: "Открытые смены",
    statOpenHint: "Время окончания не указано",
    statGross: "Брутто по сменам",
    statGrossHint: "По сменам; источник истины по деньгам — доходы",
    scopeAll: "Все модели",
    scopeFiltered: "Выбранная модель",

    filterLabel: "Фильтр",
    filterAria: "Фильтр смен по модели",
    allModels: "Все модели",
    shown: (n: number) => `Показано: ${n}`,

    platformFallback: "Площадка",
    unknownModel: "Неизвестная модель",
    unknownAccount: "Неизвестный аккаунт",

    emptyTitle: "Смены не найдены",
    emptyDescription:
      "Ни одна рабочая смена не подходит под этот фильтр. Запишите смену или сбросьте фильтр по модели, чтобы увидеть весь список.",
    colModel: "Модель",
    colAccount: "Аккаунт",
    colStarted: "Начало",
    colEnded: "Окончание",
    colDuration: "Длительность",
    colGross: "Брутто",
    badgeOpen: "Открыта",

    deleteTitle: "Удалить смену?",
    deleteDescription: (label: string) =>
      `Смена ${label} будет удалена безвозвратно. Отменить это действие нельзя.`,
    deleteBody:
      "Удаление смены убирает записанные по ней часы. Отчёты по доходам это не затрагивает.",
    deleteConfirm: "Удалить смену",
    toastDeleted: "Смена удалена",
    toastDeleteFailed: "Не удалось удалить смену",

    /* form */
    logSession: "Записать смену",
    createTitle: "Записать рабочую смену",
    editTitle: "Изменить смену",
    dialogDescription:
      "Смены — источник истины по часам (docs/04 §4.6). Оставьте время окончания пустым, чтобы открыть смену; длительность рассчитывает база данных.",
    submitCreate: "Записать смену",
    submitEdit: "Сохранить изменения",
    noAccounts:
      "Аккаунтов площадок пока нет. Сначала добавьте модель и аккаунт площадки — смена всегда привязана к аккаунту.",
    fieldModel: "Модель",
    helpModel: "Определяет, какие аккаунты доступны ниже.",
    selectModel: "Выберите модель…",
    fieldAccount: "Аккаунт площадки",
    helpNoAccounts: "У этой модели пока нет аккаунтов площадок.",
    selectAccount: "Выберите аккаунт…",
    chooseModelFirst: "Сначала выберите модель",
    fieldStartedAt: "Начало",
    helpStartedAt: "Трактуется как UTC — так же, как время отображается во всём приложении.",
    fieldEndedAt: "Окончание",
    helpDuration: (formatted: string) => `Длительность: ${formatted}`,
    helpOpenSession: "Пусто — смена открыта (ещё идёт).",
    fieldGross: "Брутто-доход",
    hintGross: "≥ 0",
    helpGross:
      "Доход за смену, если он известен. Источник истины по деньгам — раздел «Доходы».",
    fieldCurrency: "Валюта",
    helpCurrency: "Трёхбуквенный код, например USD.",
    fieldNotes: "Заметки",
    helpNotes: "Только для внутреннего пользования — модель их не видит.",
    placeholderNotes: "Всё, что стоит записать об этой смене",
    toastCreated: "Смена записана",
    toastUpdated: "Смена обновлена",
    toastCreateFailed: "Не удалось записать смену",
    toastUpdateFailed: "Не удалось обновить смену",

    /* server actions */
    errDatetime: "Укажите корректные дату и время.",
    errGrossType: "Укажите брутто-доход.",
    errGrossMin: "Брутто-доход не может быть отрицательным.",
    errAmountTooLarge: "Слишком большая сумма.",
    errCurrency: "Используйте трёхбуквенный код валюты, например USD.",
    errNotesLong: "Заметки слишком длинные.",
    errAccountRequired: "Выберите аккаунт площадки.",
    errForm: "Проверьте форму и попробуйте ещё раз.",
    errDbCheck:
      "Не выполнено правило базы данных — время окончания должно быть позже времени начала, а брутто-доход не может быть отрицательным.",
    errAccountFk:
      "Этого аккаунта площадки больше нет. Обновите страницу и попробуйте снова.",
    errSaveFailed: "Не удалось сохранить смену. Попробуйте ещё раз.",
    errVerifyAccount: "Не удалось проверить аккаунт площадки. Попробуйте ещё раз.",
    errStartInvalid: "Укажите корректные дату и время начала.",
    errEndInvalid: "Укажите корректные дату и время окончания.",
    errEndAfterStart: "Время окончания должно быть позже времени начала.",
    errGone: "Этой смены больше нет.",
    errInvalid: "Некорректная смена.",
    errDeleteFailed: "Не удалось удалить смену. Попробуйте ещё раз.",
    errNotAuthorizedLog: "У вас нет прав записывать смены.",
    errNotAuthorizedEdit: "У вас нет прав изменять смены.",
    errNotAuthorizedDelete: "У вас нет прав удалять смены.",
    msgLogged: "Смена записана.",
    msgOpenStarted: "Открытая смена начата.",
    msgUpdated: "Смена обновлена.",
    msgDeleted: "Смена удалена.",
  },

  /* -------------------------------------------------------------- earnings --- */

  earnings: {
    metaTitle: "Доходы",
    title: "Доходы",
    description:
      "Учёт денег — источник истины. Вносите по одному отчёту на аккаунт площадки за период; нетто — вход для расчёта комиссии.",

    noModelsTitle: "Моделей пока нет",
    noModelsDescription:
      "Отчёты по доходам вносятся на аккаунт площадки конкретной модели. Сначала добавьте модель и аккаунт площадки, затем вернитесь к вводу отчётов.",

    statStatements: "Отчёты",
    statGross: "Брутто",
    statGrossHint: "Начислено площадками",
    statFees: "Комиссии площадок",
    statFeesHint: "Доля площадок",
    statNet: "Нетто получено",
    statNetHint: "Вход для расчёта (docs/09)",
    scopeAll: "Все модели",
    scopeFiltered: "Выбранная модель",

    filterLabel: "Фильтр",
    filterAria: "Фильтр доходов по модели",
    allModels: "Все модели",
    shown: (n: number) => `Показано: ${n}`,

    platformFallback: "Площадка",
    unknownModel: "Неизвестная модель",
    unknownAccount: "Неизвестный аккаунт",

    emptyTitle: "Отчёты не найдены",
    emptyDescription:
      "Ни один отчёт по доходам не подходит под этот фильтр. Внесите отчёт или сбросьте фильтр по модели, чтобы увидеть весь список.",
    colModel: "Модель",
    colAccount: "Аккаунт",
    colPeriod: "Период",
    colGross: "Брутто",
    colFee: "Комиссия площадки",
    colNet: "Нетто",

    deleteTitle: "Удалить отчёт?",
    deleteDescription: (label: string) =>
      `Отчёт по доходам ${label} будет удалён безвозвратно. Отменить это действие нельзя.`,
    deleteBody:
      "Доходы — источник истины по деньгам. Удаление отчёта исключает его из исходных данных расчёта; уже проведённые операции реестра это не затрагивает.",
    deleteConfirm: "Удалить отчёт",
    toastDeleted: "Отчёт удалён",
    toastDeleteFailed: "Не удалось удалить отчёт",

    /* form */
    recordStatement: "Внести отчёт",
    createTitle: "Внести отчёт по доходам",
    editTitle: "Изменить отчёт",
    dialogDescription:
      "Доходы — источник истины по деньгам (docs/04 §4.7): одна строка на аккаунт за отчётный период. Нетто — то, что получила студия, и вход для расчёта комиссии.",
    submitCreate: "Внести отчёт",
    submitEdit: "Сохранить изменения",
    noAccounts:
      "Аккаунтов площадок пока нет. Сначала добавьте модель и аккаунт площадки — каждый отчёт привязан к аккаунту.",
    fieldModel: "Модель",
    helpModel: "Определяет, какие аккаунты доступны ниже.",
    selectModel: "Выберите модель…",
    fieldAccount: "Аккаунт площадки",
    helpFeePrefill: (percentFormatted: string) =>
      `Комиссия площадки ${percentFormatted} — подставляется в поле комиссии.`,
    helpNoAccounts: "У этой модели пока нет аккаунтов площадок.",
    selectAccount: "Выберите аккаунт…",
    chooseModelFirst: "Сначала выберите модель",
    fieldPeriodStart: "Начало периода",
    fieldPeriodEnd: "Конец периода",
    fieldGross: "Брутто",
    hintAmount: "≥ 0",
    helpGross: "Всего начислено площадкой.",
    fieldFee: "Комиссия площадки",
    helpFee: "Доля площадки.",
    fieldNet: "Нетто",
    helpNet: "То, что получила студия.",
    fieldCurrency: "Валюта",
    helpCurrency: "Трёхбуквенный код, например USD.",
    netPreview: "Нетто получено:",
    toastCreated: "Отчёт внесён",
    toastUpdated: "Отчёт обновлён",
    toastCreateFailed: "Не удалось внести отчёт",
    toastUpdateFailed: "Не удалось обновить отчёт",

    /* server actions */
    errDateInvalid: "Укажите корректную дату (ГГГГ-ММ-ДД).",
    errAmountType: "Укажите сумму.",
    errAmountMin: "Сумма не может быть отрицательной.",
    errAmountTooLarge: "Слишком большая сумма.",
    errCurrency: "Используйте трёхбуквенный код валюты, например USD.",
    errAccountRequired: "Выберите аккаунт площадки.",
    errPeriodOrder:
      "Конец периода должен быть не раньше его начала.",
    errForm: "Проверьте форму и попробуйте ещё раз.",
    errDuplicate:
      "Отчёт за этот период по этому аккаунту уже существует. На аккаунт площадки допускается только одна строка дохода за отчётный период — измените существующую.",
    errDbCheck:
      "Не выполнено правило базы данных — конец периода должен быть не раньше начала, а суммы не могут быть отрицательными.",
    errAccountFk:
      "Этого аккаунта площадки больше нет. Обновите страницу и попробуйте снова.",
    errSaveFailed: "Не удалось сохранить отчёт по доходам. Попробуйте ещё раз.",
    errVerifyAccount: "Не удалось проверить аккаунт площадки. Попробуйте ещё раз.",
    errGone: "Этого отчёта больше нет.",
    errInvalid: "Некорректный отчёт.",
    errDeleteFailed: "Не удалось удалить отчёт. Попробуйте ещё раз.",
    errNotAuthorizedRecord: "У вас нет прав вносить доходы.",
    errNotAuthorizedEdit: "У вас нет прав изменять доходы.",
    errNotAuthorizedDelete: "У вас нет прав удалять доходы.",
    msgRecorded: "Отчёт внесён.",
    msgUpdated: "Отчёт обновлён.",
    msgDeleted: "Отчёт удалён.",
  },
};
