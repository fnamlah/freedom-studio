-- =============================================================================
-- 011_seeds.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The rows the system cannot boot without:
--   1. the single default commission scheme (docs/09 §4.1 requires exactly one
--      to exist at all times, so share generation never hits a "no scheme" path)
--   2. every ai.* configuration key (docs/10 §3 step 3, docs/11 §3 and §8)
--   3. the Library classification vocabulary, whose descriptions are the text
--      the classifier prompt is built from
--
-- No business data is invented here: no platforms, no people. Every insert is
-- guarded so a re-apply is a no-op.
--
-- Note on provenance columns: commission_schemes.created_by and
-- app_settings.updated_by are NULL for these rows, which is the documented
-- "migration seed" marker — at this point in the migration order no profiles row
-- exists yet.
-- =============================================================================

set search_path = public, extensions;

-- =============================================================================
-- 1. Default commission scheme — 60 model / 10 operator pool / 30 studio
-- -----------------------------------------------------------------------------
-- Both scope columns NULL = the default tier of the resolution order
-- account-specific -> model-specific -> default. Deletion must stay blocked:
-- fn_generate_earning_shares raises if nothing resolves.
-- =============================================================================
insert into public.commission_schemes (
  model_id, platform_account_id,
  model_percent, operator_percent, studio_percent,
  effective_from, effective_to, notes, created_by
)
select null, null, 60.00, 10.00, 30.00, current_date, null,
       'Default studio scheme, seeded by migration. Exactly one default must exist at all times (docs/09 §4.1).',
       null
where not exists (
  select 1 from public.commission_schemes cs
  where cs.model_id is null and cs.platform_account_id is null
);

-- =============================================================================
-- 2. ai.* settings (docs/11)
-- -----------------------------------------------------------------------------
-- Secrets never live here: MOONSHOT_API_KEY / ZHIPU_API_KEY are server-side env
-- vars only. Everything below is non-secret and auditable — writes are
-- super_admin-only, validated by validate_app_setting and audited as
-- ai.model_switch (for ai.active_provider) or ai.settings_update.
--
-- The embedding settings are deliberately DECOUPLED from the chat switch: query
-- vectors are only comparable to stored vectors from the same model, so tying
-- them together would silently break semantic search on every chat switch.
-- =============================================================================
insert into public.app_settings (key, value, description) values
  ('ai.active_provider', '"moonshot"'::jsonb,
   'Active chat provider: "moonshot" (Kimi) or "zhipu" (GLM). Super-Admin-only switch; effective within the gateway cache TTL of at most 60 s.'),

  ('ai.chat_model.moonshot', '"kimi-k3"'::jsonb,
   'Model ID used when ai.active_provider = moonshot. A version bump is a settings change, not a deploy.'),

  ('ai.chat_model.zhipu', '"glm-5.2"'::jsonb,
   'Model ID used when ai.active_provider = zhipu.'),

  ('ai.vision_model.moonshot', '"kimi-k3-vision"'::jsonb,
   'Vision-capable Moonshot model, used by the Library classifier for image and scanned-PDF pages.'),

  ('ai.vision_model.zhipu', '"glm-5.2v"'::jsonb,
   'Vision-capable Zhipu model, used by the Library classifier for image and scanned-PDF pages.'),

  ('ai.embedding.provider', '"zhipu"'::jsonb,
   'Embedding provider. Decoupled from ai.active_provider on purpose: changing it invalidates every stored vector and requires the re-embed runbook.'),

  ('ai.embedding.model', '"embedding-3"'::jsonb,
   'Embedding model ID. fn_semantic_search filters embeddings on this value, so stale vectors from a superseded model can never pollute results mid-migration.'),

  ('ai.embedding.dim', '2048'::jsonb,
   'Embedding dimension. Must match the vector(N) column type in the embeddings table; changing it ships a migration alongside the re-embed.'),

  ('ai.limits.requests_per_user_per_hour', '30'::jsonb,
   'Per-user hourly request cap, enforced by summing ai_usage before any provider call.'),

  ('ai.limits.tokens_per_user_per_day', '200000'::jsonb,
   'Per-user daily token budget. Refusals are themselves metered (status = budget_exceeded) so abuse patterns stay visible.'),

  ('ai.limits.tokens_global_per_day', '1000000'::jsonb,
   'Global daily token budget across all users; the last in-app line before provider-console spend caps.'),

  ('ai.classify.batch_size', '5'::jsonb,
   'How many Library files one classification run processes per batch.'),

  ('ai.classify.max_file_mb', '10'::jsonb,
   'Maximum Library file size, in MB, that will be sent to the classifier. Larger files are marked skipped rather than truncated.')
on conflict (key) do nothing;

-- =============================================================================
-- 3. Library categories (doc_categories)
-- -----------------------------------------------------------------------------
-- `description` is handed verbatim to the classifier prompt as the definition of
-- each category — the wording IS the prompt, so edits here change model
-- behaviour and belong in review. `sort` drives UI ordering; 'other' sorts last.
-- `identity` is ai_enabled = false: identity documents are filed by a human
-- only, never auto-classified.
-- =============================================================================
insert into public.doc_categories (slug, name, description, ai_enabled, sort) values
  ('incoming_money', 'Incoming money',
   'Records of money arriving at the studio: platform payout statements, remittance advices, settlement reports, bank deposit confirmations. Choose this when the document evidences funds RECEIVED by the studio.',
   true, 10),

  ('receipts', 'Receipts & expenses',
   'Evidence of money the studio SPENT: purchase receipts, supplier invoices the studio pays, expense claims, equipment and subscription bills.',
   true, 20),

  ('legal', 'Legal',
   'Correspondence and filings involving lawyers, courts or authorities: legal notices, disputes, cease-and-desist letters, judgments, formal legal opinions. Routine commercial agreements belong in "contracts" instead.',
   true, 30),

  ('regulations', 'Regulations',
   'External rules the studio must comply with, published by someone else: statutes, regulatory guidance, platform compliance requirements, age-verification and record-keeping obligations.',
   true, 40),

  ('policies', 'Internal policies',
   'The studio''s own internal rules and procedures: staff handbook, code of conduct, security and privacy policies, standard operating procedures.',
   true, 50),

  ('contracts', 'Contracts',
   'Signed commercial agreements and their amendments: model and operator contracts, platform agreements, NDAs, service agreements, addenda.',
   true, 60),

  ('tax', 'Tax',
   'Tax filings and tax correspondence: returns, assessments, VAT/sales-tax records, withholding certificates, letters from tax authorities.',
   true, 70),

  ('identity', 'Identity documents',
   'Personal identity documents: passports, national IDs, driver''s licences, proof of address. Never auto-classified — a human files these.',
   false, 80),

  ('other', 'Other',
   'Anything that does not clearly belong to another category. Prefer a specific category whenever the document plainly fits one; use this only as a genuine fallback.',
   true, 999)
on conflict (slug) do nothing;
