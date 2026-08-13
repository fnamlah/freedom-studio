/**
 * Compliance & identity documents (docs/06) — the private `model-documents`
 * bucket, its derived compliance badge, the revocable share links, and the
 * per-document AI-analysis opt-in of migration 014.
 *
 * Distinct from the File Library (docs/12): a different table, bucket and threat
 * profile. These documents hold third parties' identity data, which is why the
 * consent copy below is deliberately blunt in both languages.
 */
export const documentsEn = {
  metaTitle: "Documents",
  title: "Documents",
  description:
    "Compliance & identity documents. Stored in a private bucket; retrieval is only ever a 60-second signed URL or a revocable, audited share link (docs/06).",

  noModelsTitle: "No models yet",
  noModelsDescription:
    "Compliance documents are filed against a model. Add a model first, then come back to upload identity and compliance documents.",

  statDocuments: "Documents",
  scopeAll: "All models",
  scopeFiltered: "Filtered model",
  statValid: "Valid",
  statValidHint: "More than 30 days out",
  statExpiring: "Expiring soon",
  statExpiringHint: "Within 30 days",
  statExpired: "Expired",
  statExpiredHint: "Renewal required",
  shown: (count: number) => `${count} shown`,
  unknownModel: "Unknown model",

  /* ------------------------------------------------------------- vocabulary --- */

  /** The `document_type` enum (docs/06 §1). Enum VALUES stay English in the DB. */
  docType: {
    government_id: "Government ID",
    passport: "Passport",
    contract: "Contract",
    model_release: "Model release",
    consent_form: "Consent form",
    tax_form: "Tax form",
    other: "Other",
  },
  docTypeFallback: "Document",

  /** Derived from `expires_at` (docs/06 §4) — never stored. */
  compliance: {
    valid: "Valid",
    expiring: "Expiring soon",
    expired: "Expired",
  },

  /** Derived share-link lifecycle (docs/06 §5.7). All non-active states are terminal. */
  shareStatus: {
    active: "Active",
    expired: "Expired",
    exhausted: "View limit reached",
    revoked: "Revoked",
  },

  allowedMimeLabel:
    "PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.pptx), CSV, or an image",

  /* ------------------------------------------------------------------ table --- */

  emptyTitle: "No documents to show",
  emptyDescription:
    "No compliance documents match this view. Upload one, or clear the model filter to see the full list.",
  colModel: "Model",
  colDocument: "Document",
  colType: "Type",
  colIssued: "Issued",
  colExpires: "Expires",
  colCompliance: "Compliance",
  colSize: "Size",
  archived: "Archived",
  downloadFailedTitle: "Could not download",

  filterAria: "Filter documents by model",

  /* --------------------------------------------------------- upload dialog --- */

  uploadCta: "Upload document",
  aiReading: "Reading the document…",
  aiFilledNote: "Filled in from the document — check it before saving.",
  aiFilledNothing: "Nothing could be read from this document; fill the details in by hand.",
  aiFilledBadge: "from the document",
  uploadTitle: "Upload a compliance document",
  uploadDescription:
    "Stored in a private bucket. Retrieval is only ever a 60-second signed URL or a revocable share link — every access is audited (docs/06).",
  modelLabel: "Model",
  modelPlaceholder: "Select a model…",
  typeLabel: "Document type",
  typePlaceholder: "Select a type…",
  titleLabel: "Title",
  titleHelp: "A human label, e.g. 'US Passport' or '2026 W-9'.",
  titlePlaceholder: "Document title",
  issuedLabel: "Issued date",
  issuedHelp: "When the document was issued (optional).",
  expiresLabel: "Expires",
  expiresHelp: "Drives the compliance status. Leave blank for non-expiring documents.",
  fileLabel: "File",
  fileHelp: (accepted: string, maxMb: number) => `${accepted}. Max ${maxMb} MB.`,
  filePicked: (name: string, size: string) => `${name} · ${size}`,
  notesLabel: "Notes",
  notesHelp: "Optional context stored with the record.",
  notesPlaceholder: "Optional notes",
  noFileTitle: "No file chosen",
  noFileBody: "Pick a document file to upload.",
  tooLargeTitle: "File too large",
  tooLargeBody: (maxMb: number) => `The limit is ${maxMb} MB.`,
  badTypeTitle: "Unsupported file type",
  badTypeBody: (accepted: string) => `Upload one of: ${accepted}.`,
  uploadedTitle: "Document uploaded",
  uploadFailedTitle: "Could not upload document",

  /* ------------------------------------------------------------- AI analysis --- */

  analysis: {
    btnAnalysis: "Analysis",
    btnAnalyse: "Analyse",
    btnAi: "AI",
    title: "AI analysis",
    description: (documentTitle: string) =>
      `Summarise and extract key facts from “${documentTitle}”.`,
    consentTitle: "Send this document to the AI provider",
    consentBody:
      "Compliance documents hold identity data. Analysis sends this file's contents to the configured third-party AI provider. Off by default; each change is audited. Turning it off clears any prior analysis.",
    enable: "Enable",
    disable: "Disable",
    optedIn: "Opted in",
    statusLine: (status: string, provider: string | null) =>
      provider ? `Status: ${status} · via ${provider}` : `Status: ${status}`,
    analyseNow: "Analyse now",
    reanalyse: "Re-analyse",
    summaryHeading: "Summary",
    keyFiguresHeading: "Key figures",
    noAnalysis:
      "No analysis yet. Click “Analyse now” to generate a summary and key figures.",

    /** `ai_status` as read by a human reviewing a compliance document (014). */
    status: {
      pending: "Not analysed",
      suggested: "Suggested",
      confirmed: "Analysed",
      overridden: "Analysed",
      skipped: "Skipped",
      failed: "Failed",
    },

    enabledTitle: "AI analysis enabled",
    disabledTitle: "AI analysis disabled",
    updateFailedTitle: "Could not update",
    notConfiguredTitle: "AI not configured",
    notConfiguredBody: "Add a provider API key in AI settings.",
    failedTitle: "Analysis failed",
    pleaseTryAgain: "Please try again.",
    analysedTitle: "Document analysed",
    analysedBody: "Summary and key figures are ready.",
    notCompletedTitle: "Not completed",
    notCompletedBody: (status: string, reason: string) =>
      `Analysis ${status} (${reason}).`,
    statusUnknown: "did not complete",
    reasonUnknown: "unknown",
  },

  /* ------------------------------------------------------------ share links --- */

  shares: {
    cta: "Share links",
    title: "Share links",
    description: (documentTitle: string) =>
      `Single-document, time-boxed, revocable, fully-audited access to “${documentTitle}”. Anyone with the link can view the document until it expires, hits its view limit, or is revoked.`,
    expiresLabel: "Expires",
    expiresHelp: "Required. Link stops working at end of day.",
    maxViewsLabel: "Max views",
    maxViewsHelp: "Optional. Blank = unlimited views.",
    maxViewsPlaceholder: "Unlimited",
    recipientLabel: "Recipient",
    recipientHelp: "Optional. Who is this link for?",
    recipientPlaceholder: "e.g. Accountant",
    createCta: "Create link",
    onceWarning: "Copy this link now — it is shown only once and cannot be recovered.",
    copy: "Copy",
    copied: "Copied",
    existing: "Existing links",
    emptyTitle: "No share links yet",
    emptyDescription:
      "Create one above to give an outside party time-boxed access to this document.",
    colLink: "Link",
    colRecipient: "Recipient",
    colExpires: "Expires",
    colViews: "Views",
    views: (count: string, max: string | null) => (max ? `${count} / ${max}` : count),
    audit: "Audit",
    hideAudit: "Hide audit",
    revoke: "Revoke",
    auditHeading: "View audit",
    colViewed: "Viewed",
    colUserAgent: "User agent",
    colIpHash: "IP (hashed)",
    noViews: "No views recorded for this link yet.",

    loadFailedTitle: "Could not load share links",
    createdTitle: "Share link created",
    createFailedTitle: "Could not create share link",
    revokedTitle: "Share link revoked",
    revokeFailedTitle: "Could not revoke share link",
    loadAuditFailedTitle: "Could not load view audit",
    copyFailedTitle: "Copy failed",
    copyFailedBody: "Select the link text and copy it manually.",
  },

  /* -------------------------------------------------------- server actions --- */

  actions: {
    checkForm: "Please check the form and try again.",
    forbidden: "You are not allowed to do that.",
    analyseSkipped: "That file could not be read automatically — fill the details in by hand.",
    analyseFailed: "Reading the file failed. Fill the details in by hand.",
    invalidDate: "Enter a valid date (YYYY-MM-DD).",
    chooseModel: "Choose a model.",
    titleRequired: "Give the document a title.",
    titleTooLong: "Title is too long.",
    notesTooLong: "Notes are too long.",
    chooseDocument: "Choose a document.",
    viewsInteger: "Whole number of views.",
    viewsPositive: "Must be at least 1.",
    viewsTooLarge: "That view cap is too large.",
    labelTooLong: "Label is too long.",

    modelGone: "That model no longer exists. Refresh and try again.",
    documentExists: "That document already exists. Refresh and try again.",
    dbRule: "That doesn't satisfy a database rule. Check the file and try again.",
    saveFailed: "Could not save the document. Please try again.",

    chooseFile: "Choose a file to upload.",
    tooLarge: (maxMb: number) => `That file is too large. The limit is ${maxMb} MB.`,
    badType: "That file type isn't allowed. Upload a PDF, JPEG, PNG, WebP, HEIC or TIFF.",
    storeFailed: "Could not store the file. Please try again.",
    uploaded: "Document uploaded.",
    forbiddenUpload: "You are not authorized to upload documents.",

    invalidDocument: "Invalid document.",
    documentGone: "That document no longer exists.",
    downloadFailed: "Could not prepare the download. Please try again.",
    forbiddenDownload: "You are not authorized to download documents.",

    expiryInPast: "Pick an expiry date in the future.",
    shareCreateFailed: "Could not create the share link. Please try again.",
    shareShownOnce: "Copy this link now — it is shown only once.",
    forbiddenShareCreate: "You are not authorized to create share links.",

    invalidShare: "Invalid share link.",
    shareRevokeFailed: "Could not revoke the share link. Please try again.",
    shareAlreadyRevoked: "That link is already revoked or no longer exists.",
    shareRevoked: "Share link revoked. Access ends within one minute.",
    forbiddenShareRevoke: "You are not authorized to revoke share links.",

    invalidRequest: "Invalid request.",
    optInUpdateFailed: "Could not update this document. Please try again.",
    optInOn: "AI analysis enabled for this document.",
    optInOff: "AI analysis disabled and prior analysis cleared.",
    forbiddenOptIn: "You are not authorized to change this setting.",

    sharesLoadFailed: "Could not load share links. Please try again.",
    forbiddenSharesList: "You are not authorized to view share links.",
    viewsLoadFailed: "Could not load the view audit. Please try again.",
    forbiddenViewsList: "You are not authorized to view the share audit.",
  },
};

export const documentsRu: typeof documentsEn = {
  metaTitle: "Документы",
  title: "Документы",
  description:
    "Документы соответствия и документы, удостоверяющие личность. Хранятся в приватном бакете; получить их можно только по подписанной ссылке на 60 секунд или по отзываемой ссылке доступа, каждое обращение фиксируется (docs/06).",

  noModelsTitle: "Моделей пока нет",
  noModelsDescription:
    "Документы соответствия привязываются к модели. Сначала добавьте модель, затем возвращайтесь и загружайте документы.",

  statDocuments: "Документы",
  scopeAll: "Все модели",
  scopeFiltered: "Выбранная модель",
  statValid: "Действительны",
  statValidHint: "Более 30 дней в запасе",
  statExpiring: "Скоро истекут",
  statExpiringHint: "В ближайшие 30 дней",
  statExpired: "Истекли",
  statExpiredHint: "Требуется продление",
  shown: (count: number) => `Показано: ${count}`,
  unknownModel: "Неизвестная модель",

  /* ------------------------------------------------------------- vocabulary --- */

  docType: {
    government_id: "Удостоверение личности",
    passport: "Паспорт",
    contract: "Договор",
    model_release: "Согласие на съёмку",
    consent_form: "Форма согласия",
    tax_form: "Налоговая форма",
    other: "Прочее",
  },
  docTypeFallback: "Документ",

  compliance: {
    valid: "Действителен",
    expiring: "Скоро истечёт",
    expired: "Истёк",
  },

  shareStatus: {
    active: "Активна",
    expired: "Истекла",
    exhausted: "Лимит просмотров исчерпан",
    revoked: "Отозвана",
  },

  allowedMimeLabel:
    "PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.pptx), CSV или изображение",

  /* ------------------------------------------------------------------ table --- */

  emptyTitle: "Документов нет",
  emptyDescription:
    "Под этот фильтр не подходит ни один документ. Загрузите документ или сбросьте фильтр по модели, чтобы увидеть весь список.",
  colModel: "Модель",
  colDocument: "Документ",
  colType: "Тип",
  colIssued: "Выдан",
  colExpires: "Истекает",
  colCompliance: "Статус",
  colSize: "Размер",
  archived: "В архиве",
  downloadFailedTitle: "Не удалось скачать",

  filterAria: "Фильтр документов по модели",

  /* --------------------------------------------------------- upload dialog --- */

  uploadCta: "Загрузить документ",
  aiReading: "Читаю документ…",
  aiFilledNote: "Заполнено по документу — проверьте перед сохранением.",
  aiFilledNothing: "Из этого документа ничего не удалось прочитать; заполните поля вручную.",
  aiFilledBadge: "из документа",
  uploadTitle: "Загрузка документа соответствия",
  uploadDescription:
    "Документ хранится в приватном бакете. Получить его можно только по подписанной ссылке на 60 секунд или по отзываемой ссылке доступа — каждое обращение фиксируется (docs/06).",
  modelLabel: "Модель",
  modelPlaceholder: "Выберите модель…",
  typeLabel: "Тип документа",
  typePlaceholder: "Выберите тип…",
  titleLabel: "Название",
  titleHelp: "Понятная человеку подпись, например «Загранпаспорт» или «W-9 за 2026».",
  titlePlaceholder: "Название документа",
  issuedLabel: "Дата выдачи",
  issuedHelp: "Когда документ был выдан (необязательно).",
  expiresLabel: "Истекает",
  expiresHelp:
    "Определяет статус соответствия. Оставьте пустым для бессрочных документов.",
  fileLabel: "Файл",
  fileHelp: (accepted: string, maxMb: number) => `${accepted}. Не более ${maxMb} МБ.`,
  filePicked: (name: string, size: string) => `${name} · ${size}`,
  notesLabel: "Заметки",
  notesHelp: "Необязательный комментарий, сохраняется вместе с записью.",
  notesPlaceholder: "Необязательные заметки",
  noFileTitle: "Файл не выбран",
  noFileBody: "Выберите файл документа для загрузки.",
  tooLargeTitle: "Файл слишком большой",
  tooLargeBody: (maxMb: number) => `Ограничение — ${maxMb} МБ.`,
  badTypeTitle: "Неподдерживаемый тип файла",
  badTypeBody: (accepted: string) => `Загрузите один из форматов: ${accepted}.`,
  uploadedTitle: "Документ загружен",
  uploadFailedTitle: "Не удалось загрузить документ",

  /* ------------------------------------------------------------- AI analysis --- */

  analysis: {
    btnAnalysis: "Разбор",
    btnAnalyse: "Разобрать",
    btnAi: "ИИ",
    title: "Разбор с помощью ИИ",
    description: (documentTitle: string) =>
      `Краткое изложение и ключевые факты из документа «${documentTitle}».`,
    consentTitle: "Отправить этот документ провайдеру ИИ",
    consentBody:
      "Документы соответствия содержат персональные данные. При разборе содержимое файла отправляется стороннему провайдеру ИИ. По умолчанию выключено; каждое изменение фиксируется в журнале. При выключении прежние результаты разбора удаляются.",
    enable: "Включить",
    disable: "Выключить",
    optedIn: "Согласие дано",
    statusLine: (status: string, provider: string | null) =>
      provider ? `Статус: ${status} · через ${provider}` : `Статус: ${status}`,
    analyseNow: "Разобрать сейчас",
    reanalyse: "Разобрать заново",
    summaryHeading: "Краткое изложение",
    keyFiguresHeading: "Ключевые показатели",
    noAnalysis:
      "Разбора ещё нет. Нажмите «Разобрать сейчас», чтобы получить краткое изложение и ключевые показатели.",

    status: {
      pending: "Не разобран",
      suggested: "Есть предложение",
      confirmed: "Разобран",
      overridden: "Разобран",
      skipped: "Пропущен",
      failed: "Ошибка",
    },

    enabledTitle: "Разбор ИИ включён",
    disabledTitle: "Разбор ИИ выключен",
    updateFailedTitle: "Не удалось обновить",
    notConfiguredTitle: "ИИ не настроен",
    notConfiguredBody: "Добавьте ключ API провайдера в настройках ИИ.",
    failedTitle: "Разбор не удался",
    pleaseTryAgain: "Попробуйте ещё раз.",
    analysedTitle: "Документ разобран",
    analysedBody: "Краткое изложение и ключевые показатели готовы.",
    notCompletedTitle: "Не завершено",
    notCompletedBody: (status: string, reason: string) =>
      `Разбор: ${status} (${reason}).`,
    statusUnknown: "не завершён",
    reasonUnknown: "причина неизвестна",
  },

  /* ------------------------------------------------------------ share links --- */

  shares: {
    cta: "Ссылки доступа",
    title: "Ссылки доступа",
    description: (documentTitle: string) =>
      `Доступ к одному документу «${documentTitle}» — ограниченный по сроку, отзываемый, с полным журналом обращений. Любой, у кого есть ссылка, может открыть документ, пока она не истечёт, не исчерпает лимит просмотров или не будет отозвана.`,
    expiresLabel: "Истекает",
    expiresHelp: "Обязательно. Ссылка перестаёт работать в конце этого дня.",
    maxViewsLabel: "Лимит просмотров",
    maxViewsHelp: "Необязательно. Пусто — без ограничений.",
    maxViewsPlaceholder: "Без ограничений",
    recipientLabel: "Получатель",
    recipientHelp: "Необязательно. Для кого эта ссылка?",
    recipientPlaceholder: "например, Бухгалтер",
    createCta: "Создать ссылку",
    onceWarning:
      "Скопируйте ссылку сейчас — она показывается только один раз и восстановить её нельзя.",
    copy: "Копировать",
    copied: "Скопировано",
    existing: "Существующие ссылки",
    emptyTitle: "Ссылок доступа пока нет",
    emptyDescription:
      "Создайте ссылку выше, чтобы дать внешней стороне временный доступ к этому документу.",
    colLink: "Ссылка",
    colRecipient: "Получатель",
    colExpires: "Истекает",
    colViews: "Просмотры",
    views: (count: string, max: string | null) => (max ? `${count} / ${max}` : count),
    audit: "Журнал",
    hideAudit: "Скрыть журнал",
    revoke: "Отозвать",
    auditHeading: "Журнал просмотров",
    colViewed: "Просмотрено",
    colUserAgent: "User agent",
    colIpHash: "IP (хеш)",
    noViews: "По этой ссылке ещё не было ни одного просмотра.",

    loadFailedTitle: "Не удалось загрузить ссылки доступа",
    createdTitle: "Ссылка доступа создана",
    createFailedTitle: "Не удалось создать ссылку доступа",
    revokedTitle: "Ссылка доступа отозвана",
    revokeFailedTitle: "Не удалось отозвать ссылку доступа",
    loadAuditFailedTitle: "Не удалось загрузить журнал просмотров",
    copyFailedTitle: "Не удалось скопировать",
    copyFailedBody: "Выделите текст ссылки и скопируйте его вручную.",
  },

  /* -------------------------------------------------------- server actions --- */

  actions: {
    checkForm: "Проверьте форму и попробуйте ещё раз.",
    forbidden: "У вас нет прав на это действие.",
    analyseSkipped: "Файл не удалось прочитать автоматически — заполните поля вручную.",
    analyseFailed: "Не удалось прочитать файл. Заполните поля вручную.",
    invalidDate: "Введите корректную дату (ГГГГ-ММ-ДД).",
    chooseModel: "Выберите модель.",
    titleRequired: "Укажите название документа.",
    titleTooLong: "Слишком длинное название.",
    notesTooLong: "Слишком длинные заметки.",
    chooseDocument: "Выберите документ.",
    viewsInteger: "Целое число просмотров.",
    viewsPositive: "Минимум 1.",
    viewsTooLarge: "Слишком большой лимит просмотров.",
    labelTooLong: "Слишком длинная подпись.",

    modelGone: "Такой модели больше нет. Обновите страницу и попробуйте снова.",
    documentExists: "Такой документ уже есть. Обновите страницу и попробуйте снова.",
    dbRule: "Это нарушает правило базы данных. Проверьте файл и попробуйте снова.",
    saveFailed: "Не удалось сохранить документ. Попробуйте ещё раз.",

    chooseFile: "Выберите файл для загрузки.",
    tooLarge: (maxMb: number) => `Файл слишком большой. Ограничение — ${maxMb} МБ.`,
    badType:
      "Такой тип файла не разрешён. Загрузите PDF, JPEG, PNG, WebP, HEIC или TIFF.",
    storeFailed: "Не удалось сохранить файл в хранилище. Попробуйте ещё раз.",
    uploaded: "Документ загружен.",
    forbiddenUpload: "У вас нет прав загружать документы.",

    invalidDocument: "Некорректный документ.",
    documentGone: "Такого документа больше нет.",
    downloadFailed: "Не удалось подготовить скачивание. Попробуйте ещё раз.",
    forbiddenDownload: "У вас нет прав скачивать документы.",

    expiryInPast: "Выберите дату истечения в будущем.",
    shareCreateFailed: "Не удалось создать ссылку доступа. Попробуйте ещё раз.",
    shareShownOnce: "Скопируйте ссылку сейчас — она показывается только один раз.",
    forbiddenShareCreate: "У вас нет прав создавать ссылки доступа.",

    invalidShare: "Некорректная ссылка доступа.",
    shareRevokeFailed: "Не удалось отозвать ссылку доступа. Попробуйте ещё раз.",
    shareAlreadyRevoked: "Эта ссылка уже отозвана или больше не существует.",
    shareRevoked: "Ссылка доступа отозвана. Доступ прекратится в течение минуты.",
    forbiddenShareRevoke: "У вас нет прав отзывать ссылки доступа.",

    invalidRequest: "Некорректный запрос.",
    optInUpdateFailed: "Не удалось обновить этот документ. Попробуйте ещё раз.",
    optInOn: "Разбор ИИ включён для этого документа.",
    optInOff: "Разбор ИИ выключен, прежние результаты разбора удалены.",
    forbiddenOptIn: "У вас нет прав менять эту настройку.",

    sharesLoadFailed: "Не удалось загрузить ссылки доступа. Попробуйте ещё раз.",
    forbiddenSharesList: "У вас нет прав просматривать ссылки доступа.",
    viewsLoadFailed: "Не удалось загрузить журнал просмотров. Попробуйте ещё раз.",
    forbiddenViewsList: "У вас нет прав просматривать журнал обращений по ссылке.",
  },
};
