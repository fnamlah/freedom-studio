-- =============================================================================
-- 019 — Russian/English localization
-- -----------------------------------------------------------------------------
-- The studio is operated day to day in Russian; the owner reads English. The
-- language is therefore a property of the PERSON, not of the deployment, so it
-- lives on `profiles` and rides along with every `requireUser()` call.
--
-- Deliberately NOT `app_settings`: that module's contract (src/lib/settings.ts)
-- is a single global snapshot cached for 60s and its header says in as many
-- words never to extend it with per-caller data.
--
-- Category translations are added as SEPARATE columns rather than overwriting
-- `name`/`description`, because `slug` is the classifier's stable key and the
-- English text is still what an English-reading super admin should see. The
-- classifier keeps returning slugs, so the 22 already-classified files and
-- every stored `ai_suggested_category_id` are unaffected.
-- =============================================================================

-- ---------------------------------------------------------------- profiles --

alter table public.profiles
  add column if not exists locale text not null default 'ru';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_locale_chk'
  ) then
    alter table public.profiles
      add constraint profiles_locale_chk check (locale in ('en', 'ru'));
  end if;
end $$;

comment on column public.profiles.locale is
  'UI, AI-answer and Telegram language for this person: ''ru'' (default) or ''en'' (019).';

-- The owner reads English; everyone else keeps the Russian default.
update public.profiles set locale = 'en' where email = 'faisal@falconmind.co';

-- The Playwright suite asserts on English copy, so its fixtures pin English.
update public.profiles set locale = 'en' where email like 'e2e-%@freedomstudio.test';

-- ---------------------------------------------------------- doc_categories --

alter table public.doc_categories
  add column if not exists name_ru text,
  add column if not exists description_ru text;

comment on column public.doc_categories.name_ru is
  'Russian display name. `slug` remains the stable machine key (019).';
comment on column public.doc_categories.description_ru is
  'Russian classifier prompt text, used when the requesting user reads Russian (019).';

update public.doc_categories set
  name_ru = v.name_ru,
  description_ru = v.description_ru
from (values
  ('incoming_money', 'Поступления',
   'Входящие платежи: выписки платёжных систем и банков, отчёты о выплатах от площадок, подтверждения переводов.'),
  ('receipts', 'Чеки и расходы',
   'Чеки, счета и подтверждения расходов студии: оборудование, аренда, реклама, подписки и сервисы.'),
  ('legal', 'Юридические документы',
   'Юридические материалы: уставные документы, доверенности, претензии, переписка с юристами.'),
  ('regulations', 'Регламенты и нормы',
   'Внешние требования и нормативные документы: правила площадок, требования по возрасту и верификации, соответствие законодательству.'),
  ('policies', 'Внутренние политики',
   'Внутренние правила студии: регламенты работы, инструкции для персонала, политики безопасности и конфиденциальности.'),
  ('contracts', 'Договоры',
   'Подписанные соглашения: договоры с моделями и операторами, соглашения с площадками, NDA, приложения и дополнения.'),
  ('tax', 'Налоги',
   'Налоговые документы: декларации, справки, расчёты, переписка с налоговыми органами.'),
  ('identity', 'Документы, удостоверяющие личность',
   'Паспорта, удостоверения личности, водительские права и другие документы с персональными данными.'),
  ('training', 'Обучение и скрипты',
   'Обучающие материалы для моделей: инструкции по площадкам (Stripchat, SkyPrivate, Plasma), скрипты для чата, сценарии ролевых и фетиш-сессий, списки фраз для работы в чате.'),
  ('other', 'Прочее',
   'Документы, не подходящие ни к одной другой категории.')
) as v(slug, name_ru, description_ru)
where public.doc_categories.slug = v.slug;
