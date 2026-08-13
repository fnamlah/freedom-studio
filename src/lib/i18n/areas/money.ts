// From `../locales` (dependency-free), not `../index`: index.ts imports en.ts,
// which imports this file — going through it would close an import cycle.
import { plural } from "../locales";

/**
 * Dashboard, charts and the whole Money section: ledger, payouts, statements,
 * forecasts and commission schemes.
 *
 * Money vocabulary is fixed (see the i18n brief) and used consistently here:
 *   доход(ы) · выплата · реестр операций · схема комиссий · отчёт · прогноз ·
 *   площадка · модель · оператор · смена
 *
 * `typeof moneyEn` on the Russian object is the completeness gate — a missing
 * key or a drifted function signature fails the build.
 */

export const moneyEn = {
  /* ------------------------------------------------------------- charts --- */
  charts: {
    /** Neutral: an empty set is often an RLS outcome, not a missing record. */
    noData: "No data for this period",
    /** The folded tail bucket. Must match the slice name the pie colours by. */
    other: "Other",
    value: "Value",
  },

  /* ---------------------------------------------------------- dashboard --- */
  dashboard: {
    metaTitle: "Dashboard",
    welcome: (firstName: string) => `Welcome back, ${firstName}`,
    signedInAs: (roleLabel: string) =>
      `Signed in as ${roleLabel}. Your dashboard shows only what your role permits.`,

    monthToDate: "Month to date",
    /** Unit suffix for the hours KPI tile. */
    hoursUnit: "h",
    awaiting: (n: number) => `${n} awaiting`,

    grossRevenue: "Gross revenue",
    netRevenue: "Net revenue",
    grossEarnings: "Gross earnings",
    netEarnings: "Net earnings",
    hoursWorked: "Hours worked",
    pendingPayouts: "Pending payouts",
    pendingPayout: "Pending payout",
    outstandingBalances: "Outstanding balances",
    owedToPayees: "Owed to payees",
    currentBalance: "Current balance",
    owedToYou: "Owed to you",
    ledgerShare: "Ledger share",

    earningsTrendTitle: "Earnings trend",
    earningsTrendDesc: "Net and gross by month (last 12 months).",
    earningsTrendDescOwn: "Your net and gross earnings by month.",
    seriesNet: "Net",
    seriesGross: "Gross",

    shareByModelTitle: "Earnings share by model",
    shareByModelDesc: "Net revenue mix across models (last 12 months).",
    shareByPlatformTitle: "Earnings share by platform",
    shareByPlatformDesc: "Net revenue mix across platforms (last 12 months).",
    platformShareTitle: "Platform share",
    platformShareDesc: "Your net earnings mix across platforms.",

    hoursSessionsTitle: "Hours & sessions",
    hoursSessionsDesc: "Hours worked and session count by month.",
    hoursSessionsDescOwn: "Your hours worked and session count by month.",
    seriesHours: "Hours",
    seriesSessions: "Sessions",

    modelComparisonTitle: "Model comparison",
    modelComparisonDesc: "Net revenue by model, this month vs last.",
    thisMonth: "This month",
    lastMonth: "Last month",

    projectedVsActualTitle: "Projected vs actual net",
    projectedVsActualDesc: "Realised net (solid) against the live forecast (dashed).",
    seriesActual: "Actual",
    seriesProjected: "Projected",

    complianceTitle: "Document compliance",
    complianceDesc: "Studio-wide document status.",
    complianceDescOwn: "Your document status.",
    complianceValid: "Valid",
    complianceExpiring: "Expiring",
    complianceExpired: "Expired",
    // The `: string` return annotation is load-bearing: a bare ternary would
    // infer the literal union `"document" | "documents"`, which no translation
    // could then satisfy.
    complianceCenterLabel: (n: number): string => (n === 1 ? "document" : "documents"),

    forecastBreakdownTitle: "Forecast breakdown by model",
    forecastBreakdownDesc: "Predicted net revenue for the coming months, stacked by model.",

    payoutHistoryTitle: "Payout history",
    payoutHistoryDesc: "Payout totals by month, stacked by status.",
    payoutHistoryDescOwn: "Your payout totals by month, stacked by status.",

    splitTitle: "Split distribution",
    splitDesc: "Net revenue split across studio, model and operator pools.",
    splitStudio: "Studio",
    splitModelPool: "Model pool",
    splitOperatorPool: "Operator pool",

    accuracyTitle: "Forecast accuracy",
    accuracyDesc: "Studio-wide forecast error, trailing 3 months.",
    accuracyError: "Error %",

    balancesTitle: "Payee outstanding balances",
    balancesEmpty: "No outstanding balances",

    shareTrendTitle: "Ledger share trend",
    shareTrendDesc: "Your revenue-share credits by month, from the ledger.",
    shareTrendSeries: "Share credited",

    recentPayouts: "Recent payouts",

    libraryTitle: "Library knowledge base",
    libraryDesc: "Files ingested and AI-analyzed for the assistant.",
    libraryFiles: "Files",
    libraryAnalyzed: "AI-analyzed",
    libraryAwaitingReview: "Awaiting review",
    libraryUnreadable: "Not machine-readable",
    libraryUncategorised: "Uncategorised",

    /** Fallback names for rows whose display column is null. */
    unattributed: "Unattributed",
    fallbackModel: "Model",
    fallbackPayee: "Payee",

    aiInsightTitle: "AI monthly insight",
    aiInsightEmptyTitle: "No report yet",
    aiInsightEmptyDesc:
      "Monthly market insights appear here once the first AI report is generated.",
    aiInsightHeading: (monthLabel: string, title: string) => `${monthLabel} · ${title}`,
    aiInsightFooter: (generatedAt: string, model: string) =>
      `Generated ${generatedAt} · ${model}. Full report under AI · Reports.`,
  },

  /* ------------------------------------------------------------- ledger --- */
  ledger: {
    metaTitle: "Ledger",
    title: "Ledger",
    description:
      "The append-only source of truth for what each payee is owed. Balances are SUM(amount) per payee; corrections are reversing entries, never edits (docs/09 §5).",

    entryType: {
      earning_share: "Earning share",
      adjustment: "Adjustment",
      deduction: "Deduction",
      payout_settlement: "Settlement",
    },
    /** Suffix on a payee option, e.g. "Aria · model". */
    payeeType: { model: "model", operator: "operator" },
    fallbackModel: "Model",
    fallbackOperator: "Operator",

    statEntries: "Entries",
    statCredits: "Credits",
    statCreditsHint: "Positive movements",
    statDebits: "Debits",
    statDebitsHint: "Deductions & settlements",
    statPayeeBalance: "Payee balance",
    statNetThisView: "Net (this view)",
    statOwedToPayee: "Owed to payee",
    statCreditsPlusDebits: "Credits + debits shown",

    allPayees: "All payees",
    filteredPayee: "Filtered payee",
    payee: "Payee",
    filterAria: "Filter ledger by payee",
    shown: (n: number) => `${n} shown (max 500)`,

    emptyTitle: "No ledger entries",
    emptyFiltered:
      "This payee has no ledger movements in view. Clear the filter to see the full journal.",
    emptyWriter:
      "Nothing posted yet. Close a period to generate earning-share credits, or post a manual adjustment.",
    emptyReader: "Nothing posted yet. Ledger movements will appear here as they are recorded.",

    colDate: "Date",
    colPayee: "Payee",
    colType: "Type",
    colDetails: "Details",
    colAmount: "Amount",

    provenancePeriod: (from: string, to: string) => `Period ${from} → ${to}`,
    provenanceEarning: "from earning",
    provenancePayout: "from payout",
    provenanceScheme: "scheme-priced",

    closeCta: "Close period",
    closeTitle: "Close a statement period",
    closeDesc:
      "Generates earning-share credits for every earnings row in the window. Safe to re-run — already-posted shares are skipped (docs/09 §5.3).",
    closeDone: "Done",
    closeRun: "Run share generation",
    closePeriodStart: "Period start",
    closePeriodEnd: "Period end",
    closeRunComplete: "Run complete",
    closeResult: (posted: number, skipped: number) =>
      `${posted} share${posted === 1 ? "" : "s"} posted · ${skipped} skipped (already posted). Adjust the window and run again if needed.`,
    closeHint:
      "The scheme in force at each row's period end governs its split; the studio share is the residue, never posted (docs/09 §4–5).",
    closeToastOk: "Period closed",
    closeToastErr: "Could not close period",

    postCta: "Post adjustment",
    postTitle: "Post a ledger entry",
    postDesc:
      "Manual corrections only. The ledger is append-only — fix a wrong posting with a reversing adjustment, never an edit (docs/09 §5.2).",
    postSubmit: "Post entry",
    postNoPayees:
      "No payees are available. Add a model or operator first — every ledger entry targets exactly one payee.",
    postPayeeHelp: "Money is owed to a model or operator — never the studio (docs/09 §1).",
    postSelectPayee: "Select a payee…",
    postEntryTypeLabel: "Entry type",
    postAdjustmentOption: "Adjustment (±)",
    postDeductionOption: "Deduction (−)",
    postDeductionHelp: "Withheld from the payee — stored as a negative amount.",
    postAdjustmentHelp:
      "A correction: positive credits the payee, negative reverses a prior posting.",
    postAmount: "Amount",
    postAmountHint: "≠ 0",
    postAmountHelpDeduction: "Enter the amount to withhold; the sign is applied for you.",
    postAmountHelpAdjustment: "Use a minus sign to reverse an earlier credit.",
    postCurrency: "Currency",
    postCurrencyHelp: "3-letter code, e.g. USD.",
    postDescription: "Description",
    postDescriptionHelp: "Optional. Recorded on the entry for provenance.",
    postDescriptionPlaceholder: "e.g. Reversal of duplicated March share",
    postsAs: (amount: string) => `Posts as: ${amount}`,
    postToastOk: "Ledger entry posted",
    postToastErr: "Could not post entry",

    errInvalidDate: "Enter a valid date (YYYY-MM-DD).",
    errCurrency: "Use a 3-letter currency code, e.g. USD.",
    errEnterAmount: "Enter an amount.",
    errAmountZero: "Amount can't be zero.",
    errAmountTooLarge: "That amount is too large.",
    errChoosePayee: "Choose a payee.",
    errChooseEntryType: "Choose an entry type.",
    errNoteTooLong: "Keep the note under 500 characters.",
    errPeriodOrder: "The period end must be on or after the period start.",
    errCheckForm: "Please check the form and try again.",
    errDbZero: "That posting breaks a database rule — a ledger amount can never be zero.",
    errDbMissingRef: "A referenced record no longer exists. Refresh and try again.",
    errDbPayee: "That payee could not be validated. Refresh the payee list and try again.",
    errNotAuthorizedPost: "You are not authorized to post to the ledger.",
    errPostFailed: "Could not post the ledger entry. Please try again.",
    errNotAuthorizedClose: "You are not authorized to close periods.",
    errCloseFailed: "Could not close the period. Please try again.",
    errShareGeneration: "Something went wrong running share generation.",

    okAdjustmentPosted: "Adjustment posted.",
    okDeductionPosted: "Deduction posted.",
    okCloseSummary: (posted: number, skipped: number) =>
      `${posted} share${posted === 1 ? "" : "s"} posted, ${skipped} skipped.`,
  },

  /* ------------------------------------------------------------ payouts --- */
  payouts: {
    metaTitle: "Payouts",
    title: "Payouts",
    description:
      "Maker-checker payments: finance/manager create, the Super Admin approves, finance settles. Marking paid posts the settlement ledger entry automatically (docs/09 §6).",

    /** The single payout-status dictionary — the dashboard and both tables use it. */
    status: {
      pending: "Pending",
      approved: "Approved",
      paid: "Paid",
      cancelled: "Cancelled",
    },

    statPending: "Pending",
    statApproved: "Approved",
    statPaid: "Paid",
    statTotal: "Total",
    toSettle: (amount: string) => `${amount} to settle`,
    filteredPayee: "Filtered payee",
    allPayees: "All payees",
    shown: (n: number) => `${n} shown (max 500)`,

    colPayee: "Payee",
    colPeriod: "Period",
    colGross: "Gross",
    colDeductions: "Deductions",
    colNet: "Net",
    colStatus: "Status",

    emptyTitle: "No payouts",
    emptyDesc:
      "No payouts match this view. Create one to start the maker-checker workflow, or clear the payee filter.",
    /** Dashboard "recent payouts" table. */
    dashEmptyTitle: "No payouts yet",
    dashEmptyDesc: "Payouts appear here once they are created.",

    approveCta: "Approve",
    approveTitle: "Approve this payout?",
    approveDesc:
      "Only a Super Admin can authorize a payout. This is the maker-checker gate before settlement (docs/09 §6).",
    approveConfirm: "Approve payout",
    approveBody: (net: string, payee: string) =>
      `Approving ${net} to ${payee}. Finance will then record the external payment.`,
    approveToastOk: "Payout approved",
    approveToastErr: "Could not approve",

    markPaidCta: "Mark paid",
    markPaidTitle: "Record settlement",
    markPaidDesc:
      "Mark this approved payout paid after executing the payment externally. This posts the negative settlement entry to the ledger automatically (docs/09 §6).",
    markPaidBody: (net: string, payee: string) => `Settling ${net} to ${payee}.`,
    markPaidReference: "Reference",
    markPaidReferenceHelp: "Optional — external transaction reference for the audit trail.",
    markPaidReferencePlaceholder: "e.g. TXN-48213",
    markPaidMethod: "Payment method",
    markPaidMethodHelp: "Optional — bank, wallet, etc.",
    markPaidMethodPlaceholder: "e.g. Wise transfer",
    markPaidToastOk: "Payout settled",
    markPaidToastErr: "Could not mark paid",

    cancelCta: "Cancel",
    cancelTitle: "Cancel this payout?",
    cancelDesc:
      "Cancelling is only possible before payment. A paid payout can never be cancelled — reverse it with a ledger adjustment instead (docs/09 §5.2).",
    cancelKeep: "Keep payout",
    cancelConfirm: "Cancel payout",
    cancelBody: (payee: string) => `This cancels the payout to ${payee}.`,
    cancelToastOk: "Payout cancelled",
    cancelToastErr: "Could not cancel",

    createCta: "Create payout",
    createTitle: "Create a payout",
    createDesc:
      "Creates a pending payout. A Super Admin approves it, then finance records settlement — which posts the ledger entry automatically (docs/09 §6).",
    createNoPayees:
      "No payees are available. Add a model or operator first — every payout targets exactly one payee.",
    createSelectPayee: "Select a payee…",
    createOutstanding: (amount: string) => `Outstanding balance: ${amount}`,
    createPayeeHelp: "Money is owed to a model or operator — never the studio (docs/09 §1).",
    createPeriodStart: "Period start",
    createPeriodEnd: "Period end",
    createGross: "Gross",
    createGrossHelp: "Amount owed for the period.",
    createFee: "Studio fee",
    createFeeHelp: "Studio processing fee, if any.",
    createDeductions: "Deductions",
    createDeductionsHelp: "Withheld from this payout.",
    createNet: "Net payable",
    createNetHelp: "Gross − studio fee − deductions. Editable.",
    createCurrency: "Currency",
    createCurrencyHelp: "3-letter code, e.g. USD.",
    createMethod: "Payment method",
    createMethodHelp: "Optional — bank, wallet, etc.",
    createMethodPlaceholder: "e.g. Wise transfer",
    createNotesHelp: "Optional. Context for approver and audit trail.",
    createNetPreview: (amount: string) => `Net payable: ${amount}`,
    createHintNonNegative: "≥ 0",
    createToastOk: "Payout created",
    createToastErr: "Could not create payout",

    errInvalidDate: "Enter a valid date (YYYY-MM-DD).",
    errCurrency: "Use a 3-letter currency code, e.g. USD.",
    errEnterAmount: "Enter an amount.",
    errAmountNegative: "Amount can't be negative.",
    errAmountTooLarge: "That amount is too large.",
    errTextTooLong: (max: number) => `Keep this under ${max} characters.`,
    errChoosePayee: "Choose a payee.",
    errPeriodOrder: "The period end must be on or after the period start.",
    errInvalidPayout: "Invalid payout.",
    errCheckForm: "Please check the form and try again.",
    errDbCheck:
      "That breaks a database rule — the period end must be on or after the start, and amounts can't be negative.",
    errDbPayee: "That payee could not be validated. Refresh the payee list and try again.",
    errDbForbidden: "You are not authorized for that payout action.",
    errDbGeneric: "Could not complete the payout action. Please try again.",
    errNotAuthorizedCreate: "You are not authorized to create payouts.",
    errNotAuthorizedApprove: "Only a Super Admin can approve payouts.",
    errNotAuthorizedSettle: "You are not authorized to settle payouts.",
    errNotAuthorizedCancel: "You are not authorized to cancel payouts.",
    errNotPending: "That payout can't be approved — it's no longer pending. Refresh and try again.",
    errNotApproved:
      "That payout can't be marked paid — it must be approved first (and not already paid). Refresh and try again.",
    errNotCancellable:
      "That payout can't be cancelled — it may already be paid or cancelled, or you lack permission for its current state.",

    okCreated: "Payout created (pending approval).",
    okApproved: "Payout approved.",
    okPaid: "Payout marked paid — settlement posted to the ledger.",
    okCancelled: "Payout cancelled.",
  },

  /* --------------------------------------------------------- statements --- */
  statements: {
    metaTitle: "Statements",
    title: "Statements",
    description:
      "Reproduce any payee's ledger for a period: opening balance, entries in order, closing balance. Append-only, so a past statement never changes retroactively (docs/09 §7).",

    payee: "Payee",
    selectPayee: "Select a payee…",
    from: "From",
    to: "To",
    generate: "Generate",

    noPayeesTitle: "No payees available",
    noPayeesDesc: "There are no payees you can produce a statement for.",
    pickTitle: "Pick a payee and period",
    pickDesc: "Choose a payee and a date range above, then Generate to render their statement.",
    datesTitle: "Check the dates",
    datesDesc: "The end date must be on or after the start date.",
    errorTitle: "Could not build the statement",
    errorDesc:
      "Something went wrong producing this statement. Adjust the inputs and try again.",

    headingFallback: "Statement",
    entriesCount: (n: number) => `${n} entries`,

    openingBalance: "Opening balance",
    openingHint: (dateLabel: string) => `Before ${dateLabel}`,
    movement: "Movement",
    movementHint: "Sum of entries in period",
    closingBalance: "Closing balance",
    closingHint: (dateLabel: string) => `As of ${dateLabel}`,

    noEntriesInWindow: (amount: string) =>
      `No ledger entries in this window. Opening and closing balances are equal at ${amount}.`,

    colDate: "Date",
    colType: "Type",
    colDescription: "Description",
    colAmount: "Amount",
    colBalance: "Balance",

    rowOpening: "Opening",
    rowOpeningDesc: "Balance carried forward",
    rowClosing: "Closing",
    rowClosingDesc: "Balance at period end",
    entryFallback: "Entry",
  },

  /* ---------------------------------------------------------- forecasts --- */
  forecasts: {
    metaTitle: "Forecasts",
    title: "Forecasts",
    description:
      "Projected net revenue from recent momentum (3-month moving average × clamped growth, docs/09 §8). Solid is realized; dashed is projection.",

    emptyTitle: "No forecast yet",
    emptyDesc:
      "Forecasts are computed from recorded earnings. Once a few months of statements exist, the projection and its breakdown appear here.",

    nextMonthProjected: "Next month projected",
    noHorizon: "No horizon",
    projectedHorizon: "Projected (horizon)",
    nextMonths: (n: number) => `Next ${n} months`,
    lastActualNet: "Last actual net",
    noEarningsYet: "No earnings yet",
    rollingMape: "Rolling MAPE",
    mapeHint: "Studio-wide, trailing",
    mapeEmptyHint: "Snapshot to start scoring",

    lineTitle: "Projected vs actual net revenue",
    lineDesc: "Realized monthly net (solid) continued by the live projection (dashed).",
    lineActual: "Actual net",
    linePredicted: "Projected net",
    lineEmpty: "No earnings recorded yet.",

    breakdownTitle: "Forecast breakdown by model",
    breakdownDesc: (n: number) => `Projected net per model for the next ${n} months.`,
    breakdownEmpty: "No projection to break down yet.",
    studioTotal: "Studio total",
    unknownModel: "Unknown model",
    otherModels: "Other models",

    accuracyTitle: "Forecast accuracy",
    accuracyDesc:
      "Studio-wide prediction error vs realized net, trailing months. Positive over-predicts.",
    accuracyError: "Error %",
    accuracyEmpty:
      "No snapshots scored yet — snapshot a forecast, then wait for its month to close.",

    snapshotCta: "Snapshot now",
    snapshotTitle: "Snapshot the current forecast?",
    snapshotDesc:
      "Records today's live projection to forecast_snapshots so its accuracy can be measured later against realized earnings (docs/09 §8.2).",
    snapshotBody:
      "The live projection is never stored on its own — it is recomputed on every read. A snapshot is the only way to remember what was predicted today, which is what makes the accuracy bar possible. Only one snapshot per scope is kept per day.",
    snapshotToastOk: "Forecast snapshotted",
    snapshotToastErr: "Could not snapshot",

    errAlreadySnapshotted:
      "Today's forecast has already been snapshotted — only one snapshot per scope per day is kept.",
    errNotAuthorized: "You are not authorized to snapshot the forecast.",
    errSnapshotFailed: "Could not snapshot the forecast. Please try again.",

    okSnapshotted: (n: number) =>
      `Snapshotted ${n} forecast ${n === 1 ? "row" : "rows"} for accuracy tracking.`,
    okSnapshotEmpty: "Snapshot recorded — no new forecast rows to store for this period.",
  },

  /* ------------------------------------------------------------ schemes --- */
  schemes: {
    metaTitle: "Commission schemes",
    title: "Commission schemes",
    description:
      "Three-way splits of studio net revenue — model, operator pool, and studio — scoped and effective-dated. The most specific effective scheme resolves per earning row.",

    scope: {
      account: {
        label: "Account-specific",
        short: "Account",
        description: "Overrides the model and default split for a single platform account.",
      },
      model: {
        label: "Model-specific",
        short: "Model",
        description:
          "Applies to every one of a model's accounts, unless an account scheme overrides it.",
      },
      default: {
        label: "Studio default",
        short: "Default",
        description: "The base split. Exactly one always exists and it cannot be deleted.",
      },
    },
    status: { active: "Active", scheduled: "Scheduled", ended: "Ended" },

    statTotal: "Total schemes",
    statTotalHint: "All scopes",
    statActive: "Active now",
    statActiveHint: (dateLabel: string) => `As of ${dateLabel}`,
    statModel: "Model-specific",
    statModelHint: "Per-model overrides",
    statAccount: "Account-specific",
    statAccountHint: "Per-account overrides",

    unknownModel: "Unknown model",
    unknownPlatform: "Unknown platform",
    unknownAccount: "Unknown account",
    studioDefault: "Studio default",

    explainerTitle: "How a scheme is chosen",
    explainerDesc:
      "One scheme resolves per earning row, matched on the period's close date (period_end).",
    explainerStep1Title: "Account-specific",
    explainerStep1Body:
      "A scheme for the earning's exact platform account, whose effective range contains the period's close date.",
    explainerStep2Title: "Model-specific",
    explainerStep2Body:
      "Otherwise, a scheme for the earning's model, effective on the period's close date.",
    explainerStep3Title: "Studio default",
    explainerStep3Body:
      "Otherwise, the default scheme — exactly one always exists, so resolution never fails.",
    explainerFooter:
      "The most specific effective scheme wins: account → model → default. A non-overlap exclusion per scope guarantees at most one candidate at each tier, so the split is always deterministic.",

    tableEmptyTitle: "No commission schemes yet",
    tableEmptyDesc:
      "At least the studio default scheme should exist. If this is empty, the schema seed may not have run.",
    colScope: "Scope",
    colModel: "Model",
    colOperator: "Operator",
    colStudio: "Studio",
    colEffective: "Effective",
    openEnded: "open",
    defaultCantDelete: "The studio default scheme can't be deleted.",

    deleteTitle: "Delete commission scheme",
    deleteConfirm: "Delete scheme",
    deleteBody: (split: string, effective: string) =>
      `This removes the split ${split} effective ${effective}.`,
    deleteRange: (from: string, to: string) => `${from} – ${to}`,
    deleteOnward: (from: string) => `${from} onward`,
    deleteNote:
      "If this scheme has already produced ledger entries it can't be deleted — close it with an effective-to date instead so its history stays intact.",
    deleteToastOk: "Scheme deleted",
    deleteToastErr: "Could not delete scheme",

    formNewCta: "New scheme",
    formAddTitle: "Add a commission scheme",
    formAddDesc:
      "Split studio net revenue three ways. Resolution runs account → model → default; the most specific effective scheme wins.",
    formEditTitle: "Edit commission scheme",
    formEditDesc:
      "Adjust this scheme's split or effective window. Its scope is fixed — a different scope is a different scheme.",
    formAddSubmit: "Add scheme",
    formSaveSubmit: "Save changes",
    formScope: "Scope",
    formScopeLockedHelp:
      "A scheme's scope cannot change — create a new scheme for a different scope.",
    formModel: "Model",
    formModelHelp: "The scheme applies to every account this model owns.",
    formSelectModel: "Select a model…",
    formAccount: "Platform account",
    formAccountHelp: "The scheme applies to this single platform account only.",
    formSelectAccount: "Select an account…",
    formModelPct: "Model %",
    formOperatorPct: "Operator %",
    formStudioPct: "Studio %",
    formPctHint: "0–100%",
    formOperatorPctHint: "pool, 0–100%",
    formSumRule:
      "Must total exactly 100%. Operator % is the pool, split later by assignment weights.",
    formEffectiveFrom: "Effective from",
    formEffectiveFromHelp: "The scheme governs periods whose close date falls in this window.",
    formEffectiveTo: "Effective to",
    formEffectiveToHelp:
      "Leave blank for open-ended. Set a date to close (supersede) this scheme.",
    formNotesHelp: "Optional context — why this split, or the agreement it reflects.",
    formNotesPlaceholder: "Anything the finance team should know",
    formAddToastOk: "Scheme added",
    formEditToastOk: "Scheme updated",
    formAddToastErr: "Could not add scheme",
    formEditToastErr: "Could not update scheme",

    percentRequired: {
      model: "Enter the model percentage.",
      operator: "Enter the operator pool percentage.",
      studio: "Enter the studio percentage.",
    },
    percentNegative: {
      model: "The model percentage can't be negative.",
      operator: "The operator pool percentage can't be negative.",
      studio: "The studio percentage can't be negative.",
    },
    percentMax: {
      model: "The model percentage can't exceed 100%.",
      operator: "The operator pool percentage can't exceed 100%.",
      studio: "The studio percentage can't exceed 100%.",
    },
    errEffectiveFrom: "Enter a valid effective-from date (YYYY-MM-DD).",
    errEffectiveTo: "Enter a valid effective-to date (YYYY-MM-DD).",
    errNotesTooLong: "Notes are too long.",
    errSumNot100: "Model, operator and studio percentages must add up to exactly 100%.",
    errEffectiveOrder: "The effective-to date must be after the effective-from date.",
    errChooseModel: "Choose a model.",
    errChooseAccount: "Choose a platform account.",
    errCheckForm: "Please check the form and try again.",
    errDbCheck:
      "That doesn't satisfy a database rule — percentages must total 100% and the effective dates must be in order.",
    errDbOverlap:
      "Another scheme for this scope already covers part of that date range. Close the current scheme with an effective-to date first, then add the successor.",
    errDbMissingRef: "The selected model or account no longer exists.",
    errSaveFailed: "Could not save the scheme. Please try again.",
    errNotAuthorized: "You are not authorized to manage commission schemes.",
    errGone: "That scheme no longer exists.",
    errInvalidRef: "Invalid scheme reference.",
    errLoadFailed: "Could not load that scheme.",
    errDefaultUndeletable:
      "The studio default scheme can't be deleted — exactly one default must always exist.",
    errHasLedgerEntries:
      "This scheme has already produced ledger entries and can't be deleted. Close it with an effective-to date instead.",
    errDeleteBlocked:
      "The database blocked this deletion. If this is the default scheme, it can't be removed.",

    okCreated: "Commission scheme added.",
    okUpdated: "Commission scheme updated.",
    okDeleted: "Commission scheme deleted.",

    /* ------------------------------------------------------------- tiers --- */
    tiers: {
      cta: "Tiers",
      ctaCount: (n: number) => `Tiers · ${n}`,

      title: "Income tiers",
      description:
        "The split changes with what the model earns. Add a tier for each level; the whole week is paid at the rate she reaches.",
      basis:
        "A tier is chosen by the model's TOTAL net for the week — every payout in that week counted together, not one statement at a time.",
      cliff:
        "Reaching a threshold re-prices the whole week, so a little more earned near a threshold can be worth a lot.",

      baseRow: "Below the first tier",
      baseHint: "The scheme's own percentages",

      colFrom: "Weekly net from",
      colModel: "Model",
      colTeam: "Team pool",
      colStudio: "Studio",

      add: "Add tier",
      remove: "Remove tier",
      save: "Save tiers",
      empty: "No tiers yet. This scheme always pays its base percentages.",
      emptyHint: "Add a tier to make the split rise with what she earns.",
      sumRule: "Each tier must total 100%",

      errMinRequired: "Enter the amount this tier starts at.",
      errMinNegative: "A tier can't start below zero.",
      errSumNot100: "Each tier's three percentages must total exactly 100%.",
      errDuplicateMin: "Two tiers start at the same amount. Each threshold must be different.",
      errTooMany: "That's more tiers than a scheme can hold.",
      errCheckForm: "Please check the tiers and try again.",
      errDbCheck: "A tier breaks a database rule — each one must total 100%.",
      errSaveFailed: "Could not save the tiers. Please try again.",

      okSaved: "Income tiers saved.",
      okCleared: "Income tiers removed — this scheme is back to its base percentages.",
      toastOk: "Tiers updated",
      toastErr: "Couldn't save tiers",
    },
  },
};

export const moneyRu: typeof moneyEn = {
  /* ------------------------------------------------------------- charts --- */
  charts: {
    noData: "Нет данных за этот период",
    other: "Прочее",
    value: "Значение",
  },

  /* ---------------------------------------------------------- dashboard --- */
  dashboard: {
    metaTitle: "Панель",
    welcome: (firstName: string) => `С возвращением, ${firstName}`,
    signedInAs: (roleLabel: string) =>
      `Вы вошли как ${roleLabel}. Панель показывает только то, что разрешено вашей роли.`,

    monthToDate: "С начала месяца",
    hoursUnit: "ч",
    awaiting: (n: number) => `${n} в ожидании`,

    grossRevenue: "Валовой доход",
    netRevenue: "Чистый доход",
    grossEarnings: "Валовые доходы",
    netEarnings: "Чистые доходы",
    hoursWorked: "Отработано часов",
    pendingPayouts: "Выплаты в ожидании",
    pendingPayout: "Выплата в ожидании",
    outstandingBalances: "Задолженность",
    owedToPayees: "Причитается получателям",
    currentBalance: "Текущий баланс",
    owedToYou: "Причитается вам",
    ledgerShare: "Доля по реестру",

    earningsTrendTitle: "Динамика доходов",
    earningsTrendDesc: "Чистый и валовой доход по месяцам (последние 12 месяцев).",
    earningsTrendDescOwn: "Ваши чистые и валовые доходы по месяцам.",
    seriesNet: "Чистый",
    seriesGross: "Валовой",

    shareByModelTitle: "Доли доходов по моделям",
    shareByModelDesc: "Распределение чистого дохода по моделям (последние 12 месяцев).",
    shareByPlatformTitle: "Доли доходов по площадкам",
    shareByPlatformDesc: "Распределение чистого дохода по площадкам (последние 12 месяцев).",
    platformShareTitle: "Доли площадок",
    platformShareDesc: "Распределение ваших чистых доходов по площадкам.",

    hoursSessionsTitle: "Часы и смены",
    hoursSessionsDesc: "Отработанные часы и количество смен по месяцам.",
    hoursSessionsDescOwn: "Ваши отработанные часы и количество смен по месяцам.",
    seriesHours: "Часы",
    seriesSessions: "Смены",

    modelComparisonTitle: "Сравнение моделей",
    modelComparisonDesc: "Чистый доход по моделям: этот месяц против прошлого.",
    thisMonth: "Этот месяц",
    lastMonth: "Прошлый месяц",

    projectedVsActualTitle: "Прогноз и факт по чистому доходу",
    projectedVsActualDesc:
      "Фактический чистый доход (сплошная линия) против текущего прогноза (пунктир).",
    seriesActual: "Факт",
    seriesProjected: "Прогноз",

    complianceTitle: "Соответствие документов",
    complianceDesc: "Статус документов по студии.",
    complianceDescOwn: "Статус ваших документов.",
    complianceValid: "Действуют",
    complianceExpiring: "Истекают",
    complianceExpired: "Просрочены",
    complianceCenterLabel: (n: number) =>
      plural("ru", n, { one: "документ", few: "документа", many: "документов" }),

    forecastBreakdownTitle: "Прогноз в разрезе моделей",
    forecastBreakdownDesc:
      "Прогнозируемый чистый доход на ближайшие месяцы с разбивкой по моделям.",

    payoutHistoryTitle: "История выплат",
    payoutHistoryDesc: "Суммы выплат по месяцам с разбивкой по статусам.",
    payoutHistoryDescOwn: "Ваши суммы выплат по месяцам с разбивкой по статусам.",

    splitTitle: "Распределение долей",
    splitDesc: "Распределение чистого дохода между студией, моделями и пулом операторов.",
    splitStudio: "Студия",
    splitModelPool: "Пул моделей",
    splitOperatorPool: "Пул операторов",

    accuracyTitle: "Точность прогноза",
    accuracyDesc: "Ошибка прогноза по студии за последние 3 месяца.",
    accuracyError: "Ошибка, %",

    balancesTitle: "Задолженность перед получателями",
    balancesEmpty: "Задолженности нет",

    shareTrendTitle: "Динамика доли по реестру",
    shareTrendDesc: "Ваши начисления доли дохода по месяцам — из реестра операций.",
    shareTrendSeries: "Начисленная доля",

    recentPayouts: "Последние выплаты",

    libraryTitle: "База знаний",
    libraryDesc: "Файлы, загруженные и проанализированные ИИ для ассистента.",
    libraryFiles: "Файлы",
    libraryAnalyzed: "Проанализировано ИИ",
    libraryAwaitingReview: "Ожидает проверки",
    libraryUnreadable: "Не распознаётся машиной",
    libraryUncategorised: "Без категории",

    unattributed: "Без привязки",
    fallbackModel: "Модель",
    fallbackPayee: "Получатель",

    aiInsightTitle: "Ежемесячный ИИ-обзор",
    aiInsightEmptyTitle: "Отчёта пока нет",
    aiInsightEmptyDesc:
      "Ежемесячные обзоры рынка появятся здесь после того, как будет создан первый ИИ-отчёт.",
    aiInsightHeading: (monthLabel: string, title: string) => `${monthLabel} · ${title}`,
    aiInsightFooter: (generatedAt: string, model: string) =>
      `Создан ${generatedAt} · ${model}. Полный отчёт — в разделе «ИИ · Отчёты».`,
  },

  /* ------------------------------------------------------------- ledger --- */
  ledger: {
    metaTitle: "Реестр операций",
    title: "Реестр операций",
    description:
      "Источник истины о том, сколько причитается каждому получателю; записи только добавляются. Баланс — это сумма всех сумм по получателю, а исправления вносятся сторнирующими записями, а не правкой (docs/09 §5).",

    entryType: {
      earning_share: "Доля дохода",
      adjustment: "Корректировка",
      deduction: "Удержание",
      payout_settlement: "Погашение выплаты",
    },
    payeeType: { model: "модель", operator: "оператор" },
    fallbackModel: "Модель",
    fallbackOperator: "Оператор",

    statEntries: "Записи",
    statCredits: "Начисления",
    statCreditsHint: "Положительные движения",
    statDebits: "Списания",
    statDebitsHint: "Удержания и погашения",
    statPayeeBalance: "Баланс получателя",
    statNetThisView: "Итого (в этом срезе)",
    statOwedToPayee: "Причитается получателю",
    statCreditsPlusDebits: "Показанные начисления и списания",

    allPayees: "Все получатели",
    filteredPayee: "Выбранный получатель",
    payee: "Получатель",
    filterAria: "Фильтр реестра по получателю",
    shown: (n: number) => `Показано: ${n} (максимум 500)`,

    emptyTitle: "Записей в реестре нет",
    emptyFiltered:
      "У этого получателя нет движений в текущем срезе. Снимите фильтр, чтобы увидеть весь журнал.",
    emptyWriter:
      "Пока ничего не внесено. Закройте период, чтобы начислить доли дохода, или внесите корректировку вручную.",
    emptyReader:
      "Пока ничего не внесено. Движения по реестру появятся здесь по мере их регистрации.",

    colDate: "Дата",
    colPayee: "Получатель",
    colType: "Тип",
    colDetails: "Детали",
    colAmount: "Сумма",

    provenancePeriod: (from: string, to: string) => `Период ${from} → ${to}`,
    provenanceEarning: "из дохода",
    provenancePayout: "из выплаты",
    provenanceScheme: "по схеме комиссий",

    closeCta: "Закрыть период",
    closeTitle: "Закрытие отчётного периода",
    closeDesc:
      "Начисляет доли дохода по каждой строке доходов за выбранное окно. Повторный запуск безопасен — уже начисленные доли пропускаются (docs/09 §5.3).",
    closeDone: "Готово",
    closeRun: "Начислить доли",
    closePeriodStart: "Начало периода",
    closePeriodEnd: "Конец периода",
    closeRunComplete: "Начисление выполнено",
    closeResult: (posted: number, skipped: number) =>
      `Начислено ${posted} ${plural("ru", posted, { one: "доля", few: "доли", many: "долей" })} · пропущено ${skipped} (уже начислены). При необходимости измените окно и запустите снова.`,
    closeHint:
      "Разделение по каждой строке определяет схема, действующая на конец её периода; доля студии — это остаток, она никогда не начисляется (docs/09 §4–5).",
    closeToastOk: "Период закрыт",
    closeToastErr: "Не удалось закрыть период",

    postCta: "Внести корректировку",
    postTitle: "Новая запись в реестре",
    postDesc:
      "Только ручные исправления. Реестр работает лишь на добавление — ошибочную запись исправляют сторнирующей корректировкой, а не правкой (docs/09 §5.2).",
    postSubmit: "Внести запись",
    postNoPayees:
      "Доступных получателей нет. Сначала добавьте модель или оператора — каждая запись реестра относится ровно к одному получателю.",
    postPayeeHelp: "Деньги причитаются модели или оператору, но не студии (docs/09 §1).",
    postSelectPayee: "Выберите получателя…",
    postEntryTypeLabel: "Тип записи",
    postAdjustmentOption: "Корректировка (±)",
    postDeductionOption: "Удержание (−)",
    postDeductionHelp: "Удерживается у получателя — сохраняется отрицательной суммой.",
    postAdjustmentHelp:
      "Исправление: положительная сумма начисляет получателю, отрицательная сторнирует прошлую запись.",
    postAmount: "Сумма",
    postAmountHint: "≠ 0",
    postAmountHelpDeduction: "Укажите удерживаемую сумму — знак будет проставлен автоматически.",
    postAmountHelpAdjustment: "Поставьте минус, чтобы сторнировать прежнее начисление.",
    postCurrency: "Валюта",
    postCurrencyHelp: "Трёхбуквенный код, например USD.",
    postDescription: "Описание",
    postDescriptionHelp: "Необязательно. Сохраняется в записи для прослеживаемости.",
    postDescriptionPlaceholder: "Например: сторно задвоенной мартовской доли",
    postsAs: (amount: string) => `Будет внесено: ${amount}`,
    postToastOk: "Запись внесена",
    postToastErr: "Не удалось внести запись",

    errInvalidDate: "Укажите корректную дату (ГГГГ-ММ-ДД).",
    errCurrency: "Используйте трёхбуквенный код валюты, например USD.",
    errEnterAmount: "Укажите сумму.",
    errAmountZero: "Сумма не может быть нулевой.",
    errAmountTooLarge: "Такая сумма слишком велика.",
    errChoosePayee: "Выберите получателя.",
    errChooseEntryType: "Выберите тип записи.",
    errNoteTooLong: "Уложитесь в 500 символов.",
    errPeriodOrder: "Конец периода должен быть не раньше его начала.",
    errCheckForm: "Проверьте форму и попробуйте ещё раз.",
    errDbZero: "Такая запись нарушает правило базы данных: сумма в реестре не может быть нулевой.",
    errDbMissingRef: "Связанная запись больше не существует. Обновите страницу и попробуйте снова.",
    errDbPayee: "Не удалось проверить получателя. Обновите список получателей и попробуйте снова.",
    errNotAuthorizedPost: "У вас нет прав вносить записи в реестр.",
    errPostFailed: "Не удалось внести запись в реестр. Попробуйте ещё раз.",
    errNotAuthorizedClose: "У вас нет прав закрывать периоды.",
    errCloseFailed: "Не удалось закрыть период. Попробуйте ещё раз.",
    errShareGeneration: "При начислении долей что-то пошло не так.",

    okAdjustmentPosted: "Корректировка внесена.",
    okDeductionPosted: "Удержание внесено.",
    okCloseSummary: (posted: number, skipped: number) =>
      `Начислено ${posted} ${plural("ru", posted, { one: "доля", few: "доли", many: "долей" })}, пропущено ${skipped}.`,
  },

  /* ------------------------------------------------------------ payouts --- */
  payouts: {
    metaTitle: "Выплаты",
    title: "Выплаты",
    description:
      "Платежи по принципу «исполнитель — контролёр»: финансист или менеджер создаёт выплату, супер-администратор одобряет, финансист проводит. Отметка об оплате автоматически вносит запись о погашении в реестр (docs/09 §6).",

    status: {
      pending: "В ожидании",
      approved: "Одобрена",
      paid: "Выплачена",
      cancelled: "Отменена",
    },

    statPending: "В ожидании",
    statApproved: "Одобрены",
    statPaid: "Выплачены",
    statTotal: "Всего",
    toSettle: (amount: string) => `${amount} к перечислению`,
    filteredPayee: "Выбранный получатель",
    allPayees: "Все получатели",
    shown: (n: number) => `Показано: ${n} (максимум 500)`,

    colPayee: "Получатель",
    colPeriod: "Период",
    colGross: "Валовая",
    colDeductions: "Удержания",
    colNet: "К выплате",
    colStatus: "Статус",

    emptyTitle: "Выплат нет",
    emptyDesc:
      "Под этот срез не подходит ни одна выплата. Создайте выплату, чтобы запустить процесс согласования, или снимите фильтр по получателю.",
    dashEmptyTitle: "Выплат пока нет",
    dashEmptyDesc: "Выплаты появятся здесь после их создания.",

    approveCta: "Одобрить",
    approveTitle: "Одобрить эту выплату?",
    approveDesc:
      "Санкционировать выплату может только супер-администратор. Это контрольный рубеж перед перечислением (docs/09 §6).",
    approveConfirm: "Одобрить выплату",
    approveBody: (net: string, payee: string) =>
      `Одобряется ${net} получателю ${payee}. Далее финансист зарегистрирует внешний платёж.`,
    approveToastOk: "Выплата одобрена",
    approveToastErr: "Не удалось одобрить",

    markPaidCta: "Отметить оплаченной",
    markPaidTitle: "Регистрация платежа",
    markPaidDesc:
      "Отметьте одобренную выплату оплаченной после того, как платёж выполнен во внешней системе. В реестр автоматически будет внесена отрицательная запись о погашении (docs/09 §6).",
    markPaidBody: (net: string, payee: string) =>
      `Перечисляется ${net} получателю ${payee}.`,
    markPaidReference: "Ссылка на платёж",
    markPaidReferenceHelp: "Необязательно — внешний номер операции для журнала аудита.",
    markPaidReferencePlaceholder: "Например: TXN-48213",
    markPaidMethod: "Способ оплаты",
    markPaidMethodHelp: "Необязательно — банк, кошелёк и т. п.",
    markPaidMethodPlaceholder: "Например: перевод Wise",
    markPaidToastOk: "Выплата проведена",
    markPaidToastErr: "Не удалось отметить оплаченной",

    cancelCta: "Отменить",
    cancelTitle: "Отменить эту выплату?",
    cancelDesc:
      "Отмена возможна только до перечисления. Оплаченную выплату отменить нельзя — сторнируйте её корректировкой в реестре (docs/09 §5.2).",
    cancelKeep: "Оставить выплату",
    cancelConfirm: "Отменить выплату",
    cancelBody: (payee: string) => `Выплата получателю ${payee} будет отменена.`,
    cancelToastOk: "Выплата отменена",
    cancelToastErr: "Не удалось отменить",

    createCta: "Создать выплату",
    createTitle: "Создание выплаты",
    createDesc:
      "Создаёт выплату в статусе «в ожидании». Супер-администратор одобряет её, затем финансист регистрирует перечисление — и запись в реестр вносится автоматически (docs/09 §6).",
    createNoPayees:
      "Доступных получателей нет. Сначала добавьте модель или оператора — каждая выплата адресована ровно одному получателю.",
    createSelectPayee: "Выберите получателя…",
    createOutstanding: (amount: string) => `Текущая задолженность: ${amount}`,
    createPayeeHelp: "Деньги причитаются модели или оператору, но не студии (docs/09 §1).",
    createPeriodStart: "Начало периода",
    createPeriodEnd: "Конец периода",
    createGross: "Валовая сумма",
    createGrossHelp: "Сумма, причитающаяся за период.",
    createFee: "Комиссия студии",
    createFeeHelp: "Сервисная комиссия студии, если она есть.",
    createDeductions: "Удержания",
    createDeductionsHelp: "Удерживается из этой выплаты.",
    createNet: "К выплате",
    createNetHelp: "Валовая сумма − комиссия студии − удержания. Можно изменить.",
    createCurrency: "Валюта",
    createCurrencyHelp: "Трёхбуквенный код, например USD.",
    createMethod: "Способ оплаты",
    createMethodHelp: "Необязательно — банк, кошелёк и т. п.",
    createMethodPlaceholder: "Например: перевод Wise",
    createNotesHelp: "Необязательно. Контекст для согласующего и журнала аудита.",
    createNetPreview: (amount: string) => `К выплате: ${amount}`,
    createHintNonNegative: "≥ 0",
    createToastOk: "Выплата создана",
    createToastErr: "Не удалось создать выплату",

    errInvalidDate: "Укажите корректную дату (ГГГГ-ММ-ДД).",
    errCurrency: "Используйте трёхбуквенный код валюты, например USD.",
    errEnterAmount: "Укажите сумму.",
    errAmountNegative: "Сумма не может быть отрицательной.",
    errAmountTooLarge: "Такая сумма слишком велика.",
    errTextTooLong: (max: number) => `Уложитесь в ${max} символов.`,
    errChoosePayee: "Выберите получателя.",
    errPeriodOrder: "Конец периода должен быть не раньше его начала.",
    errInvalidPayout: "Некорректная выплата.",
    errCheckForm: "Проверьте форму и попробуйте ещё раз.",
    errDbCheck:
      "Это нарушает правило базы данных: конец периода должен быть не раньше начала, а суммы не могут быть отрицательными.",
    errDbPayee: "Не удалось проверить получателя. Обновите список получателей и попробуйте снова.",
    errDbForbidden: "У вас нет прав на это действие с выплатой.",
    errDbGeneric: "Не удалось выполнить действие с выплатой. Попробуйте ещё раз.",
    errNotAuthorizedCreate: "У вас нет прав создавать выплаты.",
    errNotAuthorizedApprove: "Одобрять выплаты может только супер-администратор.",
    errNotAuthorizedSettle: "У вас нет прав проводить выплаты.",
    errNotAuthorizedCancel: "У вас нет прав отменять выплаты.",
    errNotPending:
      "Эту выплату нельзя одобрить — она больше не в статусе «в ожидании». Обновите страницу и попробуйте снова.",
    errNotApproved:
      "Эту выплату нельзя отметить оплаченной — сначала она должна быть одобрена и ещё не оплачена. Обновите страницу и попробуйте снова.",
    errNotCancellable:
      "Эту выплату нельзя отменить — возможно, она уже оплачена или отменена либо у вас нет прав для её текущего состояния.",

    okCreated: "Выплата создана и ожидает одобрения.",
    okApproved: "Выплата одобрена.",
    okPaid: "Выплата отмечена оплаченной — погашение внесено в реестр.",
    okCancelled: "Выплата отменена.",
  },

  /* --------------------------------------------------------- statements --- */
  statements: {
    metaTitle: "Отчёты",
    title: "Отчёты",
    description:
      "Воспроизведение реестра любого получателя за период: входящий баланс, записи по порядку, исходящий баланс. Реестр только пополняется, поэтому прошлый отчёт никогда не меняется задним числом (docs/09 §7).",

    payee: "Получатель",
    selectPayee: "Выберите получателя…",
    from: "С",
    to: "По",
    generate: "Сформировать",

    noPayeesTitle: "Получателей нет",
    noPayeesDesc: "Нет получателей, по которым вы можете сформировать отчёт.",
    pickTitle: "Выберите получателя и период",
    pickDesc:
      "Укажите выше получателя и диапазон дат, затем нажмите «Сформировать», чтобы построить отчёт.",
    datesTitle: "Проверьте даты",
    datesDesc: "Конечная дата должна быть не раньше начальной.",
    errorTitle: "Не удалось построить отчёт",
    errorDesc:
      "При формировании отчёта что-то пошло не так. Измените параметры и попробуйте ещё раз.",

    headingFallback: "Отчёт",
    entriesCount: (n: number) =>
      `${n} ${plural("ru", n, { one: "запись", few: "записи", many: "записей" })}`,

    openingBalance: "Входящий баланс",
    openingHint: (dateLabel: string) => `До ${dateLabel}`,
    movement: "Движение",
    movementHint: "Сумма записей за период",
    closingBalance: "Исходящий баланс",
    closingHint: (dateLabel: string) => `На ${dateLabel}`,

    noEntriesInWindow: (amount: string) =>
      `За это окно записей в реестре нет. Входящий и исходящий балансы равны: ${amount}.`,

    colDate: "Дата",
    colType: "Тип",
    colDescription: "Описание",
    colAmount: "Сумма",
    colBalance: "Баланс",

    rowOpening: "Входящий",
    rowOpeningDesc: "Перенесённый остаток",
    rowClosing: "Исходящий",
    rowClosingDesc: "Остаток на конец периода",
    entryFallback: "Запись",
  },

  /* ---------------------------------------------------------- forecasts --- */
  forecasts: {
    metaTitle: "Прогнозы",
    title: "Прогнозы",
    description:
      "Прогноз чистого дохода по недавней динамике (скользящее среднее за 3 месяца × ограниченный рост, docs/09 §8). Сплошная линия — факт, пунктир — прогноз.",

    emptyTitle: "Прогноза пока нет",
    emptyDesc:
      "Прогнозы рассчитываются по учтённым доходам. Как только накопится несколько месяцев отчётности, здесь появятся прогноз и его разбивка.",

    nextMonthProjected: "Прогноз на следующий месяц",
    noHorizon: "Горизонт не задан",
    projectedHorizon: "Прогноз на весь горизонт",
    nextMonths: (n: number) =>
      `Следующие ${n} ${plural("ru", n, { one: "месяц", few: "месяца", many: "месяцев" })}`,
    lastActualNet: "Последний факт (чистый доход)",
    noEarningsYet: "Доходов пока нет",
    rollingMape: "Скользящая MAPE",
    mapeHint: "По студии, за последние месяцы",
    mapeEmptyHint: "Сделайте снимок, чтобы начать оценку",

    lineTitle: "Прогноз и факт по чистому доходу",
    lineDesc:
      "Фактический чистый доход по месяцам (сплошная линия), продолженный текущим прогнозом (пунктир).",
    lineActual: "Факт (чистый доход)",
    linePredicted: "Прогноз (чистый доход)",
    lineEmpty: "Доходы ещё не записаны.",

    breakdownTitle: "Прогноз в разрезе моделей",
    breakdownDesc: (n: number) =>
      `Прогноз чистого дохода по моделям на следующие ${n} ${plural("ru", n, {
        one: "месяц",
        few: "месяца",
        many: "месяцев",
      })}.`,
    breakdownEmpty: "Разбивать пока нечего — прогноза нет.",
    studioTotal: "Итого по студии",
    unknownModel: "Неизвестная модель",
    otherModels: "Прочие модели",

    accuracyTitle: "Точность прогноза",
    accuracyDesc:
      "Ошибка прогноза по студии относительно фактического чистого дохода за последние месяцы. Положительное значение — перепрогноз.",
    accuracyError: "Ошибка, %",
    accuracyEmpty:
      "Оценённых снимков пока нет — сделайте снимок прогноза и дождитесь закрытия его месяца.",

    snapshotCta: "Сделать снимок",
    snapshotTitle: "Сделать снимок текущего прогноза?",
    snapshotDesc:
      "Сохраняет сегодняшний прогноз в forecast_snapshots, чтобы позже оценить его точность по фактическим доходам (docs/09 §8.2).",
    snapshotBody:
      "Текущий прогноз сам по себе нигде не хранится — он пересчитывается при каждом чтении. Снимок — единственный способ запомнить, что было спрогнозировано сегодня, и именно он делает возможной оценку точности. За сутки сохраняется только один снимок на каждый уровень.",
    snapshotToastOk: "Снимок прогноза сделан",
    snapshotToastErr: "Не удалось сделать снимок",

    errAlreadySnapshotted:
      "Сегодняшний прогноз уже сохранён — за сутки хранится только один снимок на каждый уровень.",
    errNotAuthorized: "У вас нет прав сохранять снимки прогноза.",
    errSnapshotFailed: "Не удалось сохранить снимок прогноза. Попробуйте ещё раз.",

    okSnapshotted: (n: number) =>
      `Сохранено ${n} ${plural("ru", n, {
        one: "строка",
        few: "строки",
        many: "строк",
      })} прогноза для оценки точности.`,
    okSnapshotEmpty: "Снимок записан — новых строк прогноза за этот период нет.",
  },

  /* ------------------------------------------------------------ schemes --- */
  schemes: {
    metaTitle: "Схемы комиссий",
    title: "Схемы комиссий",
    description:
      "Трёхстороннее разделение чистого дохода студии — модель, пул операторов и студия — с областью действия и датами. Для каждой строки дохода применяется самая специфичная действующая схема.",

    scope: {
      account: {
        label: "По аккаунту",
        short: "Аккаунт",
        description:
          "Переопределяет схему модели и схему по умолчанию для одного аккаунта площадки.",
      },
      model: {
        label: "По модели",
        short: "Модель",
        description:
          "Применяется ко всем аккаунтам модели, если её не переопределяет схема по аккаунту.",
      },
      default: {
        label: "Схема студии по умолчанию",
        short: "По умолчанию",
        description:
          "Базовое разделение. Всегда существует ровно одна такая схема, и удалить её нельзя.",
      },
    },
    status: { active: "Действует", scheduled: "Запланирована", ended: "Завершена" },

    statTotal: "Всего схем",
    statTotalHint: "Все области действия",
    statActive: "Действуют сейчас",
    statActiveHint: (dateLabel: string) => `На ${dateLabel}`,
    statModel: "По модели",
    statModelHint: "Переопределения по моделям",
    statAccount: "По аккаунту",
    statAccountHint: "Переопределения по аккаунтам",

    unknownModel: "Неизвестная модель",
    unknownPlatform: "Неизвестная площадка",
    unknownAccount: "Неизвестный аккаунт",
    studioDefault: "Схема студии по умолчанию",

    explainerTitle: "Как выбирается схема",
    explainerDesc:
      "Для каждой строки дохода применяется одна схема, подобранная по дате закрытия периода (period_end).",
    explainerStep1Title: "По аккаунту",
    explainerStep1Body:
      "Схема для конкретного аккаунта площадки, чей срок действия включает дату закрытия периода.",
    explainerStep2Title: "По модели",
    explainerStep2Body:
      "Иначе — схема модели, действующая на дату закрытия периода.",
    explainerStep3Title: "Схема студии по умолчанию",
    explainerStep3Body:
      "Иначе — схема по умолчанию: она всегда существует ровно в одном экземпляре, поэтому подбор никогда не срывается.",
    explainerFooter:
      "Побеждает самая специфичная действующая схема: аккаунт → модель → по умолчанию. Запрет пересечений в пределах каждого уровня гарантирует не более одного кандидата на каждом шаге, поэтому разделение всегда однозначно.",

    tableEmptyTitle: "Схем комиссий пока нет",
    tableEmptyDesc:
      "Как минимум схема студии по умолчанию должна существовать. Если список пуст, возможно, не выполнилось начальное наполнение схемы БД.",
    colScope: "Область действия",
    colModel: "Модель",
    colOperator: "Оператор",
    colStudio: "Студия",
    colEffective: "Срок действия",
    openEnded: "бессрочно",
    defaultCantDelete: "Схему студии по умолчанию удалить нельзя.",

    deleteTitle: "Удаление схемы комиссий",
    deleteConfirm: "Удалить схему",
    deleteBody: (split: string, effective: string) =>
      `Будет удалено разделение ${split}, действующее ${effective}.`,
    deleteRange: (from: string, to: string) => `с ${from} по ${to}`,
    deleteOnward: (from: string) => `с ${from} бессрочно`,
    deleteNote:
      "Если по этой схеме уже прошли записи реестра, удалить её нельзя — вместо этого закройте её датой окончания, чтобы история осталась нетронутой.",
    deleteToastOk: "Схема удалена",
    deleteToastErr: "Не удалось удалить схему",

    formNewCta: "Новая схема",
    formAddTitle: "Новая схема комиссий",
    formAddDesc:
      "Разделите чистый доход студии на три части. Подбор идёт в порядке «аккаунт → модель → по умолчанию»; побеждает самая специфичная действующая схема.",
    formEditTitle: "Изменение схемы комиссий",
    formEditDesc:
      "Измените разделение или срок действия этой схемы. Её область действия зафиксирована — другая область означает другую схему.",
    formAddSubmit: "Добавить схему",
    formSaveSubmit: "Сохранить изменения",
    formScope: "Область действия",
    formScopeLockedHelp:
      "Область действия схемы изменить нельзя — для другой области создайте новую схему.",
    formModel: "Модель",
    formModelHelp: "Схема применяется ко всем аккаунтам этой модели.",
    formSelectModel: "Выберите модель…",
    formAccount: "Аккаунт площадки",
    formAccountHelp: "Схема применяется только к этому одному аккаунту площадки.",
    formSelectAccount: "Выберите аккаунт…",
    formModelPct: "Модель, %",
    formOperatorPct: "Оператор, %",
    formStudioPct: "Студия, %",
    formPctHint: "0–100 %",
    formOperatorPctHint: "пул, 0–100 %",
    formSumRule:
      "В сумме должно быть ровно 100 %. Процент оператора — это пул, который позже делится по весам назначений.",
    formEffectiveFrom: "Действует с",
    formEffectiveFromHelp:
      "Схема применяется к периодам, дата закрытия которых попадает в это окно.",
    formEffectiveTo: "Действует по",
    formEffectiveToHelp:
      "Оставьте пустым для бессрочной схемы. Укажите дату, чтобы закрыть (заменить) эту схему.",
    formNotesHelp: "Необязательный контекст — почему такое разделение или какое соглашение оно отражает.",
    formNotesPlaceholder: "Всё, что важно знать финансовой команде",
    formAddToastOk: "Схема добавлена",
    formEditToastOk: "Схема обновлена",
    formAddToastErr: "Не удалось добавить схему",
    formEditToastErr: "Не удалось обновить схему",

    percentRequired: {
      model: "Укажите процент модели.",
      operator: "Укажите процент пула операторов.",
      studio: "Укажите процент студии.",
    },
    percentNegative: {
      model: "Процент модели не может быть отрицательным.",
      operator: "Процент пула операторов не может быть отрицательным.",
      studio: "Процент студии не может быть отрицательным.",
    },
    percentMax: {
      model: "Процент модели не может превышать 100 %.",
      operator: "Процент пула операторов не может превышать 100 %.",
      studio: "Процент студии не может превышать 100 %.",
    },
    errEffectiveFrom: "Укажите корректную дату начала действия (ГГГГ-ММ-ДД).",
    errEffectiveTo: "Укажите корректную дату окончания действия (ГГГГ-ММ-ДД).",
    errNotesTooLong: "Заметки слишком длинные.",
    errSumNot100: "Проценты модели, оператора и студии в сумме должны давать ровно 100 %.",
    errEffectiveOrder: "Дата окончания действия должна быть позже даты начала.",
    errChooseModel: "Выберите модель.",
    errChooseAccount: "Выберите аккаунт площадки.",
    errCheckForm: "Проверьте форму и попробуйте ещё раз.",
    errDbCheck:
      "Это не удовлетворяет правилу базы данных: проценты должны давать в сумме 100 %, а даты действия должны идти по порядку.",
    errDbOverlap:
      "Другая схема этого уровня уже покрывает часть указанного диапазона дат. Сначала закройте текущую схему датой окончания, затем добавьте следующую.",
    errDbMissingRef: "Выбранная модель или аккаунт больше не существует.",
    errSaveFailed: "Не удалось сохранить схему. Попробуйте ещё раз.",
    errNotAuthorized: "У вас нет прав управлять схемами комиссий.",
    errGone: "Этой схемы больше не существует.",
    errInvalidRef: "Некорректная ссылка на схему.",
    errLoadFailed: "Не удалось загрузить эту схему.",
    errDefaultUndeletable:
      "Схему студии по умолчанию удалить нельзя — ровно одна такая схема должна существовать всегда.",
    errHasLedgerEntries:
      "По этой схеме уже прошли записи реестра, поэтому удалить её нельзя. Вместо этого закройте её датой окончания действия.",
    errDeleteBlocked:
      "База данных заблокировала удаление. Если это схема по умолчанию, удалить её нельзя.",

    okCreated: "Схема комиссий добавлена.",
    okUpdated: "Схема комиссий обновлена.",
    okDeleted: "Схема комиссий удалена.",

    /* ------------------------------------------------------------ ступени --- */
    tiers: {
      cta: "Ступени",
      ctaCount: (n: number) => `Ступени · ${n}`,

      title: "Ступени дохода",
      description:
        "Распределение меняется в зависимости от того, сколько зарабатывает модель. Добавьте ступень для каждого уровня; вся неделя оплачивается по достигнутой ставке.",
      basis:
        "Ступень определяется по ОБЩЕМУ чистому доходу модели за неделю — все выплаты за эту неделю считаются вместе, а не каждый отчёт отдельно.",
      cliff:
        "При достижении порога вся неделя пересчитывается по новой ставке, поэтому небольшая сумма рядом с порогом может стоить многого.",

      baseRow: "Ниже первой ступени",
      baseHint: "Собственные проценты схемы",

      colFrom: "Чистыми за неделю от",
      colModel: "Модель",
      colTeam: "Пул команды",
      colStudio: "Студия",

      add: "Добавить ступень",
      remove: "Удалить ступень",
      save: "Сохранить ступени",
      empty: "Ступеней пока нет. Схема всегда платит по базовым процентам.",
      emptyHint: "Добавьте ступень, чтобы доля росла вместе с заработком.",
      sumRule: "Сумма каждой ступени должна быть 100%",

      errMinRequired: "Укажите сумму, с которой начинается ступень.",
      errMinNegative: "Ступень не может начинаться ниже нуля.",
      errSumNot100: "Три процента каждой ступени должны составлять ровно 100%.",
      errDuplicateMin: "Две ступени начинаются с одной суммы. Каждый порог должен быть свой.",
      errTooMany: "Столько ступеней схема вместить не может.",
      errCheckForm: "Проверьте ступени и попробуйте снова.",
      errDbCheck: "Ступень нарушает правило базы данных — сумма каждой должна быть 100%.",
      errSaveFailed: "Не удалось сохранить ступени. Попробуйте снова.",

      okSaved: "Ступени дохода сохранены.",
      okCleared: "Ступени дохода удалены — схема вернулась к базовым процентам.",
      toastOk: "Ступени обновлены",
      toastErr: "Не удалось сохранить ступени",
    },
  },
};
