import { plural, type Locale } from "../locales.js";

/**
 * Hermes — the always-on agent's own vocabulary.
 *
 * Shared by two runtimes: the Next.js `/admin/hermes` page and the Railway
 * worker in `hermes/`. The worker imports this file by RELATIVE path, so it
 * deliberately depends on nothing but `../locales` — no React, no Next, no
 * `@/` alias (aliases do not survive `tsc` emit) and not the dictionary index,
 * whose growing area imports would drag UI code into the worker bundle.
 *
 * Telegram is the only surface here that is written per-recipient rather than
 * per-request: the same broadcast reaches a Russian-reading manager and an
 * English-reading owner, so every string is a function of the reader's locale.
 */

export const hermesEn = {
  // --- Telegram: commands -------------------------------------------------
  helpTitle: "Freedom Hermes",
  helpBrief: "today's KPI digest",
  helpCompliance: "documents expiring or expired",
  helpBalances: "outstanding payee balances",
  helpApprovals: "pending proposals awaiting your decision",
  helpCost: "AI spend today against the cap",
  helpStatus: "loop heartbeats and job health",
  helpPause: "the kill switch",
  helpHelp: "this message",
  commandList: "Commands: /brief /compliance /balances /approvals /cost /status /help",

  /* ------------------------------------------------------- conversation --- */
  /** Free-text replies. Every failure says something — silence reads as broken. */
  chatNotConfigured:
    "I can't think right now — no AI provider key is configured. The commands still work: /brief /balances /approvals /compliance /cost /status",
  chatOverCap:
    "I've hit today's AI spending cap, so I can't answer freely until it resets. The commands still work: /brief /balances /approvals /compliance /cost /status",
  chatFailed:
    "Something went wrong working that out. Try again, or use a command: /brief /balances /approvals /compliance /cost /status",

  // --- Telegram: pairing and access --------------------------------------
  paired: "Paired. Freedom Hermes is now connected to this chat.",
  sendPairingCode: "Send your pairing code to connect this chat.",
  needsSuperAdmin: "That command needs a super admin.",

  // --- Balances -----------------------------------------------------------
  balancesTitle: "Outstanding balances",
  balancesEmpty: "No outstanding balances.",
  balancesError: (message: string) => `Could not read balances: ${message}`,

  // --- Approvals ----------------------------------------------------------
  approvalsEmpty: "Nothing awaiting approval.",
  approvalsError: (message: string) => `Could not read approvals: ${message}`,
  approvalsNoneForYou: (n: number) =>
    `Nothing you can decide. ${n} proposal(s) await a different role.`,
  approvalsMoreForOthers: (n: number) => `${n} more proposal(s) await a different role.`,
  approvalRequires: (role: string) => `requires ${role}`,
  approve: "✅ Approve",
  reject: "✕ Reject",
  approved: "Approved",
  rejected: "Rejected",
  rejectedNothingRan: "Rejected — nothing was executed.",
  unrecognisedAction: "Unrecognised action",
  decisionNotRecorded: "Could not record decision",
  decisionFailed: (message: string) => `Decision failed: ${message}`,

  // --- Cost ---------------------------------------------------------------
  costWithCap: (spent: string, cap: string, pct: number) =>
    `AI spend today: <b>${spent}</b> of ${cap} (${pct}%).`,
  costNoCap: (spent: string) => `AI spend today: <b>${spent}</b> (no cap configured).`,

  // --- Status -------------------------------------------------------------
  statusTitle: "Status",
  statusPaused: "⏸ PAUSED",
  statusRunning: "▶️ running",
  statusLoops: "Loops",
  statusNoHeartbeats: "• no heartbeats recorded yet",
  statusMinutesAgo: (n: number) => `${n}m ago`,
  statusUnknown: "unknown",
  statusRecentJobs: "Recent jobs",
  statusNoJobs: "• none yet",
  paused: "⏸ Paused. Scheduled jobs will not run until /resume.",
  resumed: "▶️ Resumed.",

  // --- Morning brief ------------------------------------------------------
  briefTitle: (month: string) => `Freedom Studio — ${month}`,
  briefOutstanding: (amount: string) => `Outstanding to payees: <b>${amount}</b>`,
  briefPayouts: (pending: number, approved: number) =>
    `Payouts: ${pending} pending · ${approved} approved awaiting settlement`,
  briefCompliance: (expired: number, expiring: number) =>
    `Compliance: ${expired} expired · ${expiring} expiring`,

  // --- Compliance watch ---------------------------------------------------
  complianceTitle: "Compliance watch",
  complianceExpired: (n: number) => `Expired (${n})`,
  complianceExpiring: (n: number) => `Expiring within 30 days (${n})`,
  complianceUnknownModel: "Unknown",

  // --- Period close proposal ---------------------------------------------
  closeCardTitle: "Period ready to close",
  closeCardBody: (n: number, gross: string) =>
    `${n} earning(s) with no shares posted, ${gross} gross.`,
  closeSummary: (from: string, to: string, n: number) =>
    `Close ${from} → ${to}: ${n} earning(s) have no commission shares posted.`,
  closeRisk:
    "Posts commission shares to the append-only ledger. Ledger entries cannot be edited or deleted once written — a mistake is corrected by posting an adjustment, not by undoing this.",

  // --- Executor results ---------------------------------------------------
  closed: (from: string, to: string, posted: number, skipped: number) =>
    `Closed ${from} → ${to}: ${posted} share(s) posted, ${skipped} skipped.`,
  closedAlready: (posted: number) =>
    `Period already posted on an earlier attempt (${posted} shares).`,
  forecastWritten: (rows: number, months: number) =>
    `Forecast snapshot written: ${rows} row(s), ${months} month(s) ahead.`,
  forecastAlready: (rows: number) => `Forecast already snapshotted (${rows} rows).`,
  payoutCreated: (id: string, net: string) =>
    `Payout created as PENDING (${id}, net ${net}). It still needs super-admin approval in the app.`,
  payoutAlready: (id: string) => `Payout already created (${id}).`,
  payoutOpenExists: (id: string) => `An open payout already exists for this period (${id}).`,
  payoutNote: "Proposed by Freedom Hermes; approved in-app before creation.",

  // --- Approval lifecycle errors -----------------------------------------
  approvalNotFound: "Approval not found.",
  approvalAlreadyExecuted: "Already executed.",
  approvalNotApproved: (state: string) => `Not approved (state=${state}).`,
  approvalNoDecider: "Approval has no recorded decider.",
  approverNotAuthorised: "Approver is no longer authorised.",
  approvalNoExecutor: (action: string) => `No executor for ${action}.`,
  approvalFailedPermanently: (attempts: number, message: string) =>
    `Failed after ${attempts} attempts: ${message}`,
  approvalAttemptFailed: (attempt: number, message: string) =>
    `Attempt ${attempt} failed: ${message}`,
  approvalsExpired: (n: number) => `${n} Hermes proposal(s) expired without a decision.`,

  // --- Action / role labels (raw enums rendered to humans) ----------------
  action: {
    close_period: "Close period",
    create_payout: "Create payout",
    snapshot_forecast: "Snapshot forecast",
    approve_payout: "Approve payout",
    mark_payout_paid: "Mark payout paid",
    delete_document: "Delete document",
  } as Record<string, string>,
  role: {
    super_admin: "Super Admin",
    manager: "Manager",
    finance: "Finance",
    model: "Model",
    operator: "Operator",
  } as Record<string, string>,
  payee: {
    model: "model",
    operator: "operator",
  } as Record<string, string>,
};

export const hermesRu: typeof hermesEn = {
  helpTitle: "Freedom Hermes",
  helpBrief: "сводка показателей за сегодня",
  helpCompliance: "документы с истекающим или истёкшим сроком",
  helpBalances: "остатки к выплате",
  helpApprovals: "предложения, ожидающие вашего решения",
  helpCost: "расходы на ИИ сегодня и лимит",
  helpStatus: "состояние циклов и заданий",
  helpPause: "аварийный выключатель",
  helpHelp: "это сообщение",
  commandList: "Команды: /brief /compliance /balances /approvals /cost /status /help",

  /* --------------------------------------------------------- разговор --- */
  chatNotConfigured:
    "Сейчас я не могу думать — не настроен ключ ИИ-провайдера. Команды по-прежнему работают: /brief /balances /approvals /compliance /cost /status",
  chatOverCap:
    "Достигнут дневной лимит расходов на ИИ, поэтому свободно отвечать пока не могу. Команды работают: /brief /balances /approvals /compliance /cost /status",
  chatFailed:
    "Что-то пошло не так при обработке. Попробуйте ещё раз или используйте команду: /brief /balances /approvals /compliance /cost /status",

  paired: "Готово. Freedom Hermes подключён к этому чату.",
  sendPairingCode: "Отправьте код привязки, чтобы подключить этот чат.",
  needsSuperAdmin: "Для этой команды нужны права супер-админа.",

  balancesTitle: "Остатки к выплате",
  balancesEmpty: "Непогашенных остатков нет.",
  balancesError: (message: string) => `Не удалось получить остатки: ${message}`,

  approvalsEmpty: "Нет предложений, ожидающих решения.",
  approvalsError: (message: string) => `Не удалось получить предложения: ${message}`,
  approvalsNoneForYou: (n: number) =>
    `Для вас решений нет. ${n} ${plural("ru", n, {
      one: "предложение ожидает",
      few: "предложения ожидают",
      many: "предложений ожидают",
    })} другой роли.`,
  approvalsMoreForOthers: (n: number) =>
    `Ещё ${n} ${plural("ru", n, {
      one: "предложение ожидает",
      few: "предложения ожидают",
      many: "предложений ожидают",
    })} другой роли.`,
  approvalRequires: (role: string) => `требуется роль: ${role}`,
  approve: "✅ Одобрить",
  reject: "✕ Отклонить",
  approved: "Одобрено",
  rejected: "Отклонено",
  rejectedNothingRan: "Отклонено — ничего не выполнено.",
  unrecognisedAction: "Неизвестное действие",
  decisionNotRecorded: "Не удалось записать решение",
  decisionFailed: (message: string) => `Решение не записано: ${message}`,

  costWithCap: (spent: string, cap: string, pct: number) =>
    `Расходы на ИИ сегодня: <b>${spent}</b> из ${cap} (${pct}%).`,
  costNoCap: (spent: string) => `Расходы на ИИ сегодня: <b>${spent}</b> (лимит не задан).`,

  statusTitle: "Состояние",
  statusPaused: "⏸ ПРИОСТАНОВЛЕН",
  statusRunning: "▶️ работает",
  statusLoops: "Циклы",
  statusNoHeartbeats: "• сигналов ещё не было",
  statusMinutesAgo: (n: number) =>
    `${n} ${plural("ru", n, { one: "минуту", few: "минуты", many: "минут" })} назад`,
  statusUnknown: "неизвестно",
  statusRecentJobs: "Последние задания",
  statusNoJobs: "• пока нет",
  paused: "⏸ Приостановлено. Задания по расписанию не запустятся до /resume.",
  resumed: "▶️ Возобновлено.",

  briefTitle: (month: string) => `Freedom Studio — ${month}`,
  briefOutstanding: (amount: string) => `К выплате моделям и операторам: <b>${amount}</b>`,
  briefPayouts: (pending: number, approved: number) =>
    `Выплаты: ${pending} в ожидании · ${approved} одобрено, ждут перечисления`,
  briefCompliance: (expired: number, expiring: number) =>
    `Документы: ${expired} просрочено · ${expiring} истекает`,

  complianceTitle: "Контроль документов",
  complianceExpired: (n: number) => `Просрочено (${n})`,
  complianceExpiring: (n: number) => `Истекает в течение 30 дней (${n})`,
  complianceUnknownModel: "Без имени",

  closeCardTitle: "Период готов к закрытию",
  closeCardBody: (n: number, gross: string) =>
    `${n} ${plural("ru", n, {
      one: "начисление без разнесённых долей",
      few: "начисления без разнесённых долей",
      many: "начислений без разнесённых долей",
    })}, ${gross} валом.`,
  closeSummary: (from: string, to: string, n: number) =>
    `Закрыть период ${from} → ${to}: по ${n} ${plural("ru", n, {
      one: "начислению",
      few: "начислениям",
      many: "начислениям",
    })} не разнесены комиссионные доли.`,
  closeRisk:
    "Разносит комиссионные доли в реестр, который работает только на добавление. Записи реестра нельзя изменить или удалить — ошибка исправляется корректирующей проводкой, а не отменой.",

  closed: (from: string, to: string, posted: number, skipped: number) =>
    `Период ${from} → ${to} закрыт: разнесено ${posted} ${plural("ru", posted, {
      one: "доля",
      few: "доли",
      many: "долей",
    })}, пропущено ${skipped}.`,
  closedAlready: (posted: number) =>
    `Период уже был закрыт ранее (разнесено долей: ${posted}).`,
  forecastWritten: (rows: number, months: number) =>
    `Снимок прогноза сохранён: ${rows} ${plural("ru", rows, {
      one: "строка",
      few: "строки",
      many: "строк",
    })}, горизонт ${months} мес.`,
  forecastAlready: (rows: number) => `Снимок прогноза уже был сделан (строк: ${rows}).`,
  payoutCreated: (id: string, net: string) =>
    `Выплата создана со статусом «в ожидании» (${id}, к перечислению ${net}). Её всё ещё должен одобрить супер-админ в приложении.`,
  payoutAlready: (id: string) => `Выплата уже создана (${id}).`,
  payoutOpenExists: (id: string) => `За этот период уже есть открытая выплата (${id}).`,
  payoutNote: "Предложено Freedom Hermes; создано после одобрения в приложении.",

  approvalNotFound: "Предложение не найдено.",
  approvalAlreadyExecuted: "Уже выполнено.",
  approvalNotApproved: (state: string) => `Не одобрено (статус: ${state}).`,
  approvalNoDecider: "У предложения не записан автор решения.",
  approverNotAuthorised: "У одобрившего больше нет необходимых прав.",
  approvalNoExecutor: (action: string) => `Нет исполнителя для действия «${action}».`,
  approvalFailedPermanently: (attempts: number, message: string) =>
    `Не удалось после ${attempts} ${plural("ru", attempts, {
      one: "попытки",
      few: "попыток",
      many: "попыток",
    })}: ${message}`,
  approvalAttemptFailed: (attempt: number, message: string) =>
    `Попытка ${attempt} не удалась: ${message}`,
  approvalsExpired: (n: number) =>
    `${n} ${plural("ru", n, {
      one: "предложение Hermes истекло",
      few: "предложения Hermes истекли",
      many: "предложений Hermes истекли",
    })} без решения.`,

  action: {
    close_period: "Закрытие периода",
    create_payout: "Создание выплаты",
    snapshot_forecast: "Снимок прогноза",
    approve_payout: "Одобрение выплаты",
    mark_payout_paid: "Отметка о перечислении",
    delete_document: "Удаление документа",
  },
  role: {
    super_admin: "Супер-админ",
    manager: "Менеджер",
    finance: "Финансы",
    model: "Модель",
    operator: "Оператор",
  },
  payee: {
    model: "модель",
    operator: "оператор",
  },
};

export function hermesDict(locale: Locale): typeof hermesEn {
  return locale === "ru" ? hermesRu : hermesEn;
}
