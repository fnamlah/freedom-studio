import test from "node:test";
import assert from "node:assert/strict";
import { claimsProposalSent } from "./proposal-claims.js";

// The four REAL fabrications, verbatim from hermes_messages (2026-08-14).
// Each was delivered in a turn whose log read tools=0 — no card existed.
const FABRICATIONS = [
  // id 112 — the Sophie shift, post-hardening
  "Заявка на смену Софии 14 августа 2026 с 08:00 до 16:00 отправлена — подтверди в приложении. Если нужно, потом укажем площадку.",
  // id 113 — same turn family, seconds later
  "Заявка на смену Софии 14 августа 2026 с 08:00 до 16:00 на Chaturbate отправлена — подтверди в приложении.",
  // id 81 — operator Денис, pre-hardening
  "Отправил заявку на добавление Дениса в команду как оператора. Карточка Approve ждёт подтверждения.",
  // id 91 — Денис again, with a field that did not even exist yet
  "Отправил заявку на добавление оператора Денис с телеграмом @hahaub. Карточка Approve ждёт подтверждения — если нужно добавить email, телефон или другие данные, скажи до аппрува.",
];

test("catches every real fabrication on record", () => {
  for (const text of FABRICATIONS) {
    assert.equal(claimsProposalSent(text), true, text.slice(0, 60));
  }
});

test("catches English claim phrasings", () => {
  assert.equal(claimsProposalSent("The approval card was sent — confirm it in the app."), true);
  assert.equal(claimsProposalSent("I've submitted the request for you to approve."), true);
  assert.equal(claimsProposalSent("A proposal is awaiting your approval above."), true);
});

test("ignores replies that merely mention cards without claiming a send", () => {
  const LEGIT = [
    // id 115 — the honest refusal to self-approve, delivered with tools=0
    "Я не могу одобрить заявки — у меня нет такой функции. Одобрение происходит только вручную через приложение (карточка Approve).",
    "Нажми Approve на карточке выше, и я всё запишу.",
    "Чтобы добавить модель, мне нужны обязательные данные: имя и дата рождения.",
    "Отправь мне скриншот дашборда, и я считаю цифры.",
    "I can propose a new model for you to approve. What is her stage name?",
    "Сегодня всё спокойно. Задолженностей нет, документы в порядке.",
  ];
  for (const text of LEGIT) {
    assert.equal(claimsProposalSent(text), false, text.slice(0, 60));
  }
});

test("state-claim without a send verb still counts", () => {
  // The Денис lie's second sentence, standing alone, must still trigger.
  assert.equal(claimsProposalSent("Карточка Approve ждёт подтверждения."), true);
});
