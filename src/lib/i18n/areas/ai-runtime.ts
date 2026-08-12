/**
 * Runtime error text from AI route handlers and the MFA helper.
 *
 * These are the strings a user actually sees when something goes wrong mid-flow
 * — a classify request rejected, an analysis refused, an authenticator that
 * would not enrol. They live in their own area because they belong to no page:
 * the routes are called by fetch from several screens.
 */

export const aiRuntimeEn = {
  invalidJson: "Invalid JSON body.",
  invalidRequest: "Invalid request.",
  documentNotFound: "Document not found.",
  notOptedIn: "This document is not opted in to AI analysis.",
  budgetReached: "AI budget reached. Try again later.",
  totpEnrollFailed: "Could not start TOTP enrollment.",
  totpChallengeFailed: "Could not start the TOTP challenge.",
};

export const aiRuntimeRu: typeof aiRuntimeEn = {
  invalidJson: "Некорректное тело запроса.",
  invalidRequest: "Некорректный запрос.",
  documentNotFound: "Документ не найден.",
  notOptedIn: "Для этого документа не включён ИИ-анализ.",
  budgetReached: "Достигнут лимит расходов на ИИ. Попробуйте позже.",
  totpEnrollFailed: "Не удалось начать подключение аутентификатора.",
  totpChallengeFailed: "Не удалось запросить код подтверждения.",
};
