-- =============================================================================
-- 018 — `training` library category
-- -----------------------------------------------------------------------------
-- The studio's onboarding corpus (platform guides, chat scripts, role-play
-- playbooks) has no sensible home in the seeded category set (011), so the
-- classifier — whose vocabulary is built from ai_enabled categories — would
-- have filed it all under `other`. The description below is not decoration:
-- it is fed verbatim into the classification prompt (classify.ts) and is what
-- teaches the model which files belong here.
-- =============================================================================

insert into public.doc_categories (slug, name, description, ai_enabled, sort)
values (
  'training',
  'Training & scripts',
  'Performer training and onboarding material: camsite platform guides and setup instructions (Stripchat, SkyPrivate, Plasma), chat and free-chat scripts, role-play and fetish session playbooks, phrase lists for chat work.',
  true,
  90
)
on conflict (slug) do nothing;
