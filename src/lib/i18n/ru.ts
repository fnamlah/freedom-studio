import { aiRuntimeRu } from "./areas/ai-runtime";
import { authFlowRu } from "./areas/auth-flow";
import { documentsRu } from "./areas/documents";
import { libraryRu } from "./areas/library";
import { studioRu } from "./areas/studio";
import { adminAiRu } from "./areas/admin-ai";
import { moneyRu } from "./areas/money";
import type { Dictionary } from "./en";

/**
 * The Russian dictionary.
 *
 * `satisfies Dictionary` is load-bearing: it makes a missing or misspelled key,
 * or a function whose signature drifted from the English one, a COMPILE ERROR.
 * At ~1,500 strings that type constraint is the only practical guarantee that a
 * screen never renders half-English.
 *
 * Style: the studio's own register — «вы» is implied but not written at people,
 * headings are noun phrases, and interface verbs are imperative («Сохранить»,
 * not «Сохраните»).
 */
export const ru = {
  common: {
    appName: "Freedom Studio",
    appDescription: "Внутренняя система управления студией.",
    save: "Сохранить",
    cancel: "Отмена",
    close: "Закрыть",
    delete: "Удалить",
    edit: "Изменить",
    next: "Далее",
    previous: "Назад",
    filter: "Фильтр",
    clear: "Сбросить",
    apply: "Применить",
    download: "Скачать",
    loading: "Загрузка…",
    all: "Все",
    actions: "Действия",
    status: "Статус",
    total: "Итого",
    notes: "Заметки",
    unknownError: "Что-то пошло не так. Попробуйте ещё раз.",
    tryAgain: "Попробовать снова",
  },

  locale: {
    label: "Язык",
    switchTo: (name: string) => `Переключить на ${name}`,
    changeFailed: "Не удалось изменить язык.",
  },

  nav: {
    dashboard: "Панель",
    sectionStudio: "Студия",
    models: "Модели",
    operators: "Операторы",
    platforms: "Площадки",
    sessions: "Рабочие смены",
    earnings: "Доходы",
    documents: "Документы",
    inbox: "Входящие",
    library: "Библиотека",
    sectionMoney: "Финансы",
    schemes: "Схемы комиссий",
    ledger: "Реестр операций",
    payouts: "Выплаты",
    statements: "Отчёты",
    forecasts: "Прогнозы",
    sectionIntelligence: "Аналитика",
    ai: "ИИ-ассистент",
    aiReports: "Отчёты ИИ",
    sectionAdmin: "Администрирование",
    hermes: "Гермес",
    users: "Пользователи",
    invitations: "Приглашения",
    auditLog: "Журнал действий",
    settings: "Настройки",
  },

  shell: {
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    signOut: "Выйти",
    signingOut: "Выход…",
    mfaVerified: "2FA подтверждена",
    rlsFooter: "Row Level Security — окончательный контроль доступа.",
  },

  roles: {
    super_admin: "Супер-админ",
    manager: "Менеджер",
    model: "Модель",
    finance: "Финансы",
    operator: "Оператор",
  },

  auth: {
    signInTitle: "Вход",
    email: "Email",
    password: "Пароль",
    confirmPassword: "Подтвердите пароль",
    signIn: "Войти",
    signingIn: "Вход…",
    invalidCredentials: "Неверный email или пароль.",
    setPasswordTitle: "Задайте пароль",
    setPasswordCta: "Сохранить пароль и продолжить",
    passwordMismatch: "Пароли не совпадают.",
    mfaEnrollTitle: "Настройка двухфакторной аутентификации",
    mfaEnrollIntro:
      "Двухфакторная аутентификация обязательна. Отсканируйте код в приложении-аутентификаторе и введите шестизначный код, который оно покажет.",
    mfaSecretLabel: "Или введите этот ключ вручную",
    mfaChallengeTitle: "Двухфакторное подтверждение",
    mfaChallengeIntro: "Введите шестизначный код из приложения-аутентификатора.",
    otpLabel: "Код подтверждения",
    verify: "Подтвердить",
    verifyAndContinue: "Подтвердить и продолжить",
    finishAndContinue: "Завершить и продолжить",
    invalidOtp: "Код не принят. Попробуйте следующий.",
    forbiddenTitle: "Недоступно для вашей роли",
    backToDashboard: "Вернуться на панель",
  },

  authFlow: authFlowRu,

  library: libraryRu,
  documents: documentsRu,
  studio: studioRu,
  adminAi: adminAiRu,
  money: moneyRu,

  aiRuntime: aiRuntimeRu,
} satisfies Dictionary;
