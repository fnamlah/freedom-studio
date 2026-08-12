import { plural } from "../index";

/**
 * File Library (docs/12) + the Super-Admin category vocabulary it files against
 * (docs/12 §5, `/admin/categories`).
 *
 * Note what is NOT here: the category NAMES themselves. Those live in
 * `doc_categories.name` / `name_ru` (migration 019) because the vocabulary is
 * user-manageable — a Super Admin can add a category the dictionary has never
 * heard of. `categoryName()` in `library-meta.ts` picks the column; this file
 * only carries the chrome around it.
 */
export const libraryEn = {
  metaTitle: "Library",
  title: "Library",
  description:
    "The studio's own operating documents — statements, receipts, contracts, policies, tax records. Org-wide, filed into folders and categories. Anything not marked exempt is sent to the AI once for a category suggestion you confirm (docs/12).",
  manageCategories: "Manage categories",

  statFiles: "Files",
  statFilesHint: "In the Library",
  statFiled: "Filed",
  statFiledHint: "A category set by a human",
  statPending: "Pending",
  statPendingHint: "Awaiting classification",
  statNeedsReview: "Needs review",
  statNeedsReviewHint: "AI suggested a category",

  noCategories:
    "No categories exist yet. A Super Admin defines the classification vocabulary under Admin → Categories before the classifier has anything to suggest.",
  noCategoriesCta: "Open Admin → Categories",

  /* ------------------------------------------------------------ workspace --- */

  tabFiles: "Files",
  tabReview: "Review queue",

  classifyAll: (pending: number) =>
    pending > 0 ? `Classify all pending (${pending})` : "Classify all pending",
  classifying: "Classifying…",
  classifyingProgress: (done: number, left: number) =>
    `Classifying… (${done} done, ${left} left)`,

  aiNotConfiguredTitle: "AI not configured",
  aiNotConfiguredBody: "The classification service is not available yet.",
  aiNotConfiguredNotice:
    "AI classification is not configured. Files can still be filed by hand; the classifier and the review queue activate once a provider is set up (docs/12 §4.4).",
  classifyErrorTitle: "Classification error",
  classifyDoneTitle: "Classification complete",
  classifyDoneBody: (count: number) =>
    `Classified ${count} ${plural("en", count, {
      one: "file",
      other: "files",
    })}. Review the suggestions.`,
  classifyNoneLeft: "No pending files remained.",
  classifyStalledTitle: "Classification stalled",
  classifyStalledBody: "No files were processed. Please try again later.",
  classifiedOneTitle: "Classified",
  classifiedOneBody: "Review the suggestion in the review queue.",

  emptyTitle: "The Library is empty",
  emptyDescription:
    "Upload the studio's operating paperwork — statements, receipts, contracts, policies, tax records. Files are org-wide and filed into virtual folders and categories.",

  folders: "Folders",
  allFiles: "All files",
  shown: (count: number) => `${count} shown`,
  folderEmptyTitle: "No files in this folder",
  folderEmptyDescription:
    "Nothing is filed here yet. Upload a file or pick another folder.",

  /* ---------------------------------------------------- classification meta --- */

  /** The `ai_review_status` state machine of docs/12 §4.3, as review labels. */
  aiStatus: {
    pending: "Pending",
    suggested: "Needs review",
    confirmed: "Confirmed",
    overridden: "Overridden",
    skipped: "Skipped",
    failed: "Failed",
  },

  uncategorized: "Uncategorized",
  /** A category the classifier is never told about (docs/12 §6). */
  aiOff: (name: string) => `${name} (AI off)`,

  /* ------------------------------------------------------------ file cards --- */

  exempt: "Exempt",
  classify: "Classify",
  deleteFileTitle: "Delete this file?",
  deleteFileDescription:
    "The file object and its metadata are removed. This cannot be undone.",
  deleteFileCta: "Delete file",
  fileInFolder: (name: string, folder: string) => `${name} in ${folder}`,
  downloadFailedTitle: "Could not download",
  fileDeletedTitle: "File deleted",
  deleteFailedTitle: "Could not delete file",

  /* ---------------------------------------------------------- review queue --- */

  reviewEmptyTitle: "Nothing to review",
  reviewEmptyDescription:
    "When the classifier proposes a category, the file appears here for you to confirm or override. The machine never files anything on its own.",
  suggestedLabel: "Suggested",
  why: "Why: ",
  confirmSuggestion: "Confirm suggestion",
  orOverride: "or override:",
  overrideAria: (name: string) => `Override category for ${name}`,
  chooseCategoryPlaceholder: "Choose a category…",
  applyOverride: "Apply override",
  confirmedTitle: "Suggestion confirmed",
  confirmFailedTitle: "Could not confirm",
  chooseCategoryTitle: "Choose a category",
  chooseCategoryBody: "Pick a category to file this file under.",
  filedTitle: "Filed",
  fileFailedTitle: "Could not file",

  /* --------------------------------------------------------- upload dialog --- */

  uploadCta: "Upload file",
  uploadTitle: "Upload a file to the Library",
  uploadDescription:
    "Stored in a private bucket. There is no share-link path into the Library; retrieval is only ever a 60-second signed URL (docs/12).",
  folderLabel: "Folder",
  folderHelp:
    "A virtual folder such as /tax or /contracts/2026. It organizes filing only; the file's bytes are stored flat.",
  displayNameLabel: "Display name",
  displayNameHelp: "Optional. Defaults to the uploaded file's name.",
  displayNamePlaceholder: "e.g. Q1 platform payout statement",
  categoryLabel: "Category",
  categoryHelp:
    "Optional. File it by hand now, or leave blank and let the AI suggest one for review.",
  categoryPlaceholder: "Let the AI suggest…",
  fileLabel: "File",
  fileHelp: (maxMb: number, aiMaxMb: number) =>
    `Max ${maxMb} MB. Files over ${aiMaxMb} MB are stored but skipped by the classifier.`,
  filePicked: (name: string, size: string) => `${name} · ${size}`,
  exemptToggle: "Exempt this file from AI classification",
  /**
   * The REQUIRED sentence from docs/12 §6 ("The honest limitation"). Exemption is
   * a decision made AT UPLOAD: a file nobody marks exempt transits the provider
   * once, before any suggestion exists to review.
   */
  exemptNotice:
    "Anything not marked exempt will be sent to the AI provider once for classification.",
  exemptConfirmed:
    "Marked exempt — this file will never leave the system for classification.",
  noFileTitle: "No file chosen",
  noFileBody: "Pick a file to upload.",
  tooLargeTitle: "File too large",
  tooLargeBody: (maxMb: number) => `The limit is ${maxMb} MB.`,
  uploadedTitle: "File uploaded",
  uploadFailedTitle: "Could not upload file",

  /* ------------------------------------------------ classification driver --- */

  classifyUnreachable: "Could not reach the classification service.",
  classifyFailed: "Classification failed. Please try again.",
  classifyBadResponse: "Unexpected response from the classification service.",

  /* -------------------------------------------------------- server actions --- */

  actions: {
    checkForm: "Please check the form and try again.",
    folderTooLong: "That folder path is too long.",
    nameTooLong: "That name is too long.",
    categoryGone: "That category no longer exists. Refresh and try again.",
    fileExists: "That file already exists. Refresh and try again.",
    dbRule: "That doesn't satisfy a database rule. Check the folder and try again.",
    saveFailed: "Could not save the file. Please try again.",
    chooseFile: "Choose a file to upload.",
    tooLarge: (maxMb: number) => `That file is too large. The limit is ${maxMb} MB.`,
    storeFailed: "Could not store the file. Please try again.",
    uploadedExempt:
      "File uploaded. It is exempt and will never be sent to the AI provider.",
    uploadedFiled: "File uploaded and filed. It will not be classified by the AI.",
    uploadedPending: "File uploaded. It is pending classification.",
    forbiddenUpload: "You are not authorized to upload Library files.",
    fileGone: "That file no longer exists.",
    noSuggestion: "There is no AI suggestion to confirm for this file.",
    chooseCategory: "Choose a category to file this file under.",
    categoryGoneShort: "That category no longer exists.",
    fileFailed: "Could not file the document. Please try again.",
    confirmed: "Suggestion confirmed and filed.",
    overridden: "Filed under the chosen category.",
    forbiddenFile: "You are not authorized to file Library files.",
    invalidFile: "Invalid file.",
    downloadFailed: "Could not prepare the download. Please try again.",
    forbiddenDownload: "You are not authorized to download Library files.",
    deleteFailed: "Could not delete the file. Please try again.",
    deleted: "File deleted.",
    forbiddenDelete: "You are not authorized to delete Library files.",
  },

  /* ------------------------------------------------- categories (SA only) --- */

  categories: {
    metaTitle: "Categories",
    title: "Categories",
    description:
      "The Library's classification vocabulary. Each description is the prompt text the classifier uses to decide a file's category — edits change model behaviour, so this surface is Super Admin only (docs/12).",

    newCategory: "New category",
    colCategory: "Category",
    colSlug: "Slug",
    colDescription: "Description (prompt text)",
    colAi: "AI",
    colSort: "Sort",
    aiOnTitle: "The classifier may suggest this category. Click to disable.",
    aiOffTitle: "Human-only filing. Click to enable AI suggestions.",
    aiOn: "Enabled",
    aiOffShort: "Off",

    editTitle: "Edit category",
    editorDescription:
      "The description is handed verbatim to the classifier as the category's definition — editing it changes how files are suggested.",
    createCta: "Create category",
    saveCta: "Save changes",
    slugLabel: "Slug",
    slugHelpCreate: "Stable machine key, e.g. incoming_money. Cannot be changed later.",
    slugHelpEdit: "The slug is a stable machine key and cannot be renamed.",
    slugPlaceholder: "incoming_money",
    sortLabel: "Sort",
    sortHelp: "UI ordering. Lower sorts first.",
    nameLabel: "Name",
    namePlaceholder: "Incoming money",
    descriptionLabel: "Description",
    descriptionHelp:
      "Prompt text: the definition the classifier uses to decide whether a file belongs here.",
    descriptionPlaceholder:
      "Platform payout statements, remittance advices, settlement reports — money received.",
    aiEnabledToggle: "Enabled for AI classification",
    aiEnabledHelp:
      "When off, the classifier is never told this category exists — filing under it is human-only (docs/12 §6). This is the control used for identity documents.",

    deleteTitle: "Delete this category?",
    deleteDescription: "A category still referenced by a file cannot be deleted.",
    deleteCta: "Delete category",

    createdTitle: "Category created",
    updatedTitle: "Category updated",
    saveFailedTitle: "Could not save category",
    updateFailedTitle: "Could not update category",
    deletedTitle: "Category deleted",
    deleteFailedTitle: "Could not delete category",

    actions: {
      checkForm: "Please check the form and try again.",
      slugRequired: "Give the category a slug.",
      slugTooLong: "That slug is too long.",
      slugShape:
        "Slug must be lowercase letters, numbers and underscores, starting with a letter.",
      nameRequired: "Give the category a name.",
      nameTooLong: "That name is too long.",
      descriptionTooLong: "That description is too long.",
      sortInteger: "Sort must be a whole number.",
      sortNegative: "Sort cannot be negative.",
      sortTooLarge: "That sort value is too large.",
      invalid: "Invalid category.",
      slugTaken: "A category with that slug already exists.",
      createFailed: "Could not create the category. Please try again.",
      created: "Category created.",
      updateFailed: "Could not update the category. Please try again.",
      updated: "Category updated.",
      aiEnabled: "Category enabled for AI suggestions.",
      aiDisabled: "Category is now human-only filing.",
      inUse: "This category is in use by one or more files and cannot be deleted.",
      deleteFailed: "Could not delete the category. Please try again.",
      deleted: "Category deleted.",
      forbidden: "You are not authorized to manage categories.",
    },
  },
};

export const libraryRu: typeof libraryEn = {
  metaTitle: "Библиотека",
  title: "Библиотека",
  description:
    "Рабочие документы студии — выписки, чеки, договоры, регламенты, налоговые документы. Общие для всей студии, разложены по папкам и категориям. Всё, что не помечено как исключение, один раз уходит в ИИ за предложением категории, которое вы подтверждаете (docs/12).",
  manageCategories: "Управление категориями",

  statFiles: "Файлы",
  statFilesHint: "В библиотеке",
  statFiled: "С категорией",
  statFiledHint: "Категорию задал человек",
  statPending: "В очереди",
  statPendingHint: "Ожидают классификации",
  statNeedsReview: "Требуют проверки",
  statNeedsReviewHint: "ИИ предложил категорию",

  noCategories:
    "Категории ещё не заданы. Классификационный словарь задаёт супер-админ в разделе «Администрирование → Категории» — до этого классификатору нечего предлагать.",
  noCategoriesCta: "Открыть «Администрирование → Категории»",

  /* ------------------------------------------------------------ workspace --- */

  tabFiles: "Файлы",
  tabReview: "Очередь проверки",

  classifyAll: (pending: number) =>
    pending > 0
      ? `Классифицировать всё в очереди (${pending})`
      : "Классифицировать всё в очереди",
  classifying: "Классификация…",
  classifyingProgress: (done: number, left: number) =>
    `Классификация… (готово ${done}, осталось ${left})`,

  aiNotConfiguredTitle: "ИИ не настроен",
  aiNotConfiguredBody: "Служба классификации пока недоступна.",
  aiNotConfiguredNotice:
    "Классификация ИИ не настроена. Файлы по-прежнему можно раскладывать вручную; классификатор и очередь проверки заработают, как только будет настроен провайдер (docs/12 §4.4).",
  classifyErrorTitle: "Ошибка классификации",
  classifyDoneTitle: "Классификация завершена",
  classifyDoneBody: (count: number) =>
    `Классифицировано ${count} ${plural("ru", count, {
      one: "файл",
      few: "файла",
      many: "файлов",
    })}. Проверьте предложения.`,
  classifyNoneLeft: "Файлов в очереди не осталось.",
  classifyStalledTitle: "Классификация остановилась",
  classifyStalledBody: "Ни один файл не был обработан. Попробуйте позже.",
  classifiedOneTitle: "Классифицировано",
  classifiedOneBody: "Проверьте предложение в очереди проверки.",

  emptyTitle: "Библиотека пуста",
  emptyDescription:
    "Загрузите рабочие документы студии — выписки, чеки, договоры, регламенты, налоговые документы. Файлы общие для всей студии и раскладываются по виртуальным папкам и категориям.",

  folders: "Папки",
  allFiles: "Все файлы",
  shown: (count: number) => `Показано: ${count}`,
  folderEmptyTitle: "В этой папке нет файлов",
  folderEmptyDescription:
    "Здесь пока ничего нет. Загрузите файл или выберите другую папку.",

  /* ---------------------------------------------------- classification meta --- */

  aiStatus: {
    pending: "В очереди",
    suggested: "Требует проверки",
    confirmed: "Подтверждено",
    overridden: "Изменено вручную",
    skipped: "Пропущено",
    failed: "Ошибка",
  },

  uncategorized: "Без категории",
  aiOff: (name: string) => `${name} (без ИИ)`,

  /* ------------------------------------------------------------ file cards --- */

  exempt: "Исключён",
  classify: "Классифицировать",
  deleteFileTitle: "Удалить этот файл?",
  deleteFileDescription:
    "Будут удалены и сам файл, и его метаданные. Отменить это нельзя.",
  deleteFileCta: "Удалить файл",
  fileInFolder: (name: string, folder: string) => `${name} в папке ${folder}`,
  downloadFailedTitle: "Не удалось скачать",
  fileDeletedTitle: "Файл удалён",
  deleteFailedTitle: "Не удалось удалить файл",

  /* ---------------------------------------------------------- review queue --- */

  reviewEmptyTitle: "Проверять нечего",
  reviewEmptyDescription:
    "Когда классификатор предложит категорию, файл появится здесь — вы подтвердите предложение или выберете другую категорию. Машина ничего не раскладывает сама.",
  suggestedLabel: "Предложено",
  why: "Почему: ",
  confirmSuggestion: "Подтвердить предложение",
  orOverride: "или выбрать другую:",
  overrideAria: (name: string) => `Выбрать другую категорию для файла ${name}`,
  chooseCategoryPlaceholder: "Выберите категорию…",
  applyOverride: "Применить",
  confirmedTitle: "Предложение подтверждено",
  confirmFailedTitle: "Не удалось подтвердить",
  chooseCategoryTitle: "Выберите категорию",
  chooseCategoryBody: "Укажите категорию, в которую отнести этот файл.",
  filedTitle: "Категория задана",
  fileFailedTitle: "Не удалось задать категорию",

  /* --------------------------------------------------------- upload dialog --- */

  uploadCta: "Загрузить файл",
  uploadTitle: "Загрузка файла в библиотеку",
  uploadDescription:
    "Файл хранится в приватном бакете. Ссылок для внешнего доступа у библиотеки нет; получить файл можно только по подписанной ссылке на 60 секунд (docs/12).",
  folderLabel: "Папка",
  folderHelp:
    "Виртуальная папка, например /tax или /contracts/2026. Она влияет только на раскладку; сами файлы хранятся плоским списком.",
  displayNameLabel: "Отображаемое имя",
  displayNameHelp: "Необязательно. По умолчанию — имя загруженного файла.",
  displayNamePlaceholder: "например, Отчёт площадки о выплатах за I квартал",
  categoryLabel: "Категория",
  categoryHelp:
    "Необязательно. Задайте категорию вручную или оставьте пустым — ИИ предложит её на проверку.",
  categoryPlaceholder: "Пусть предложит ИИ…",
  fileLabel: "Файл",
  fileHelp: (maxMb: number, aiMaxMb: number) =>
    `Не более ${maxMb} МБ. Файлы больше ${aiMaxMb} МБ сохраняются, но классификатор их пропускает.`,
  filePicked: (name: string, size: string) => `${name} · ${size}`,
  exemptToggle: "Исключить этот файл из ИИ-классификации",
  exemptNotice:
    "Всё, что не помечено как исключение, один раз уходит провайдеру ИИ для классификации.",
  exemptConfirmed:
    "Помечен как исключение — этот файл никогда не покинет систему ради классификации.",
  noFileTitle: "Файл не выбран",
  noFileBody: "Выберите файл для загрузки.",
  tooLargeTitle: "Файл слишком большой",
  tooLargeBody: (maxMb: number) => `Ограничение — ${maxMb} МБ.`,
  uploadedTitle: "Файл загружен",
  uploadFailedTitle: "Не удалось загрузить файл",

  /* ------------------------------------------------ classification driver --- */

  classifyUnreachable: "Не удалось связаться со службой классификации.",
  classifyFailed: "Классификация не удалась. Попробуйте ещё раз.",
  classifyBadResponse: "Неожиданный ответ от службы классификации.",

  /* -------------------------------------------------------- server actions --- */

  actions: {
    checkForm: "Проверьте форму и попробуйте ещё раз.",
    folderTooLong: "Слишком длинный путь к папке.",
    nameTooLong: "Слишком длинное имя.",
    categoryGone: "Такой категории больше нет. Обновите страницу и попробуйте снова.",
    fileExists: "Такой файл уже есть. Обновите страницу и попробуйте снова.",
    dbRule: "Это нарушает правило базы данных. Проверьте папку и попробуйте снова.",
    saveFailed: "Не удалось сохранить файл. Попробуйте ещё раз.",
    chooseFile: "Выберите файл для загрузки.",
    tooLarge: (maxMb: number) => `Файл слишком большой. Ограничение — ${maxMb} МБ.`,
    storeFailed: "Не удалось сохранить файл в хранилище. Попробуйте ещё раз.",
    uploadedExempt:
      "Файл загружен. Он помечен как исключение и никогда не уйдёт провайдеру ИИ.",
    uploadedFiled: "Файл загружен, категория задана. ИИ его классифицировать не будет.",
    uploadedPending: "Файл загружен. Он ожидает классификации.",
    forbiddenUpload: "У вас нет прав загружать файлы в библиотеку.",
    fileGone: "Такого файла больше нет.",
    noSuggestion: "Для этого файла нет предложения ИИ, которое можно подтвердить.",
    chooseCategory: "Укажите категорию, в которую отнести этот файл.",
    categoryGoneShort: "Такой категории больше нет.",
    fileFailed: "Не удалось задать категорию. Попробуйте ещё раз.",
    confirmed: "Предложение подтверждено, категория задана.",
    overridden: "Файл отнесён к выбранной категории.",
    forbiddenFile: "У вас нет прав задавать категории файлам библиотеки.",
    invalidFile: "Некорректный файл.",
    downloadFailed: "Не удалось подготовить скачивание. Попробуйте ещё раз.",
    forbiddenDownload: "У вас нет прав скачивать файлы библиотеки.",
    deleteFailed: "Не удалось удалить файл. Попробуйте ещё раз.",
    deleted: "Файл удалён.",
    forbiddenDelete: "У вас нет прав удалять файлы библиотеки.",
  },

  /* ------------------------------------------------- categories (SA only) --- */

  categories: {
    metaTitle: "Категории",
    title: "Категории",
    description:
      "Классификационный словарь библиотеки. Описание каждой категории — это текст промпта, по которому классификатор определяет категорию файла: правки меняют поведение модели, поэтому раздел доступен только супер-админу (docs/12).",

    newCategory: "Новая категория",
    colCategory: "Категория",
    colSlug: "Слаг",
    colDescription: "Описание (текст промпта)",
    colAi: "ИИ",
    colSort: "Порядок",
    aiOnTitle: "Классификатор может предлагать эту категорию. Нажмите, чтобы отключить.",
    aiOffTitle: "Только ручная раскладка. Нажмите, чтобы включить предложения ИИ.",
    aiOn: "Включена",
    aiOffShort: "Выкл.",

    editTitle: "Изменить категорию",
    editorDescription:
      "Описание передаётся классификатору дословно как определение категории — правки меняют то, какие файлы он будет к ней относить.",
    createCta: "Создать категорию",
    saveCta: "Сохранить изменения",
    slugLabel: "Слаг",
    slugHelpCreate:
      "Устойчивый машинный ключ, например incoming_money. Позже изменить нельзя.",
    slugHelpEdit: "Слаг — устойчивый машинный ключ, переименовать его нельзя.",
    slugPlaceholder: "incoming_money",
    sortLabel: "Порядок",
    sortHelp: "Порядок в интерфейсе. Меньшие значения выше.",
    nameLabel: "Название",
    namePlaceholder: "Поступления",
    descriptionLabel: "Описание",
    descriptionHelp:
      "Текст промпта: определение, по которому классификатор решает, относится ли файл к этой категории.",
    descriptionPlaceholder:
      "Отчёты площадок о выплатах, уведомления о переводах, отчёты о расчётах — полученные деньги.",
    aiEnabledToggle: "Доступна для ИИ-классификации",
    aiEnabledHelp:
      "Если выключено, классификатору вообще не сообщают о существовании этой категории — раскладка в неё только ручная (docs/12 §6). Именно так закрыты документы, удостоверяющие личность.",

    deleteTitle: "Удалить эту категорию?",
    deleteDescription: "Категорию, на которую ссылается хотя бы один файл, удалить нельзя.",
    deleteCta: "Удалить категорию",

    createdTitle: "Категория создана",
    updatedTitle: "Категория обновлена",
    saveFailedTitle: "Не удалось сохранить категорию",
    updateFailedTitle: "Не удалось обновить категорию",
    deletedTitle: "Категория удалена",
    deleteFailedTitle: "Не удалось удалить категорию",

    actions: {
      checkForm: "Проверьте форму и попробуйте ещё раз.",
      slugRequired: "Укажите слаг категории.",
      slugTooLong: "Слишком длинный слаг.",
      slugShape:
        "Слаг может состоять только из строчных латинских букв, цифр и подчёркиваний и должен начинаться с буквы.",
      nameRequired: "Укажите название категории.",
      nameTooLong: "Слишком длинное название.",
      descriptionTooLong: "Слишком длинное описание.",
      sortInteger: "Порядок должен быть целым числом.",
      sortNegative: "Порядок не может быть отрицательным.",
      sortTooLarge: "Слишком большое значение порядка.",
      invalid: "Некорректная категория.",
      slugTaken: "Категория с таким слагом уже существует.",
      createFailed: "Не удалось создать категорию. Попробуйте ещё раз.",
      created: "Категория создана.",
      updateFailed: "Не удалось обновить категорию. Попробуйте ещё раз.",
      updated: "Категория обновлена.",
      aiEnabled: "Категория доступна для предложений ИИ.",
      aiDisabled: "Теперь раскладка в эту категорию только ручная.",
      inUse: "Эта категория используется одним или несколькими файлами, её нельзя удалить.",
      deleteFailed: "Не удалось удалить категорию. Попробуйте ещё раз.",
      deleted: "Категория удалена.",
      forbidden: "У вас нет прав управлять категориями.",
    },
  },
};
