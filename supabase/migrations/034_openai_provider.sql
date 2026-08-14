-- =============================================================================
-- 034 — OpenAI as an embedding provider
-- -----------------------------------------------------------------------------
-- The original embedding default (`zhipu` / `embedding-3`) was written against
-- Zhipu's MAINLAND platform. Their international platform (z.ai) sells no
-- embeddings product at all — verified empirically (Unknown Model 1211 for
-- every candidate name) and in their docs (the model index lists zero
-- embedding models). The index has 0 rows because the feature could never
-- have run from here.
--
-- OpenAI's text-embedding-3-large takes a `dimensions` parameter, so it drops
-- into the existing `embeddings.embedding vector(2048)` column unchanged —
-- the adapters pass dimensions=2048 and no schema change is needed.
--
-- Enum values are append-only in Postgres; this is purely additive and cannot
-- affect any existing row or check. The value is USED (settings flip) in a
-- separate statement after this commits, as ADD VALUE requires.
-- =============================================================================

alter type public.ai_provider add value if not exists 'openai';

comment on type public.ai_provider is
  'AI providers the studio can route to. moonshot/zhipu chat; openai added (034) for embeddings — z.ai international sells no embeddings product.';

-- The typed-settings guard (007) predates the third provider; widen its
-- provider whitelist. Chat stays effectively moonshot/zhipu — nothing routes
-- chat to openai — but the guard validates VALUES, and 'openai' is now one.
create or replace function public.validate_app_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text := new.value #>> '{}';
  v_num  numeric;
begin
  if new.key in ('ai.active_provider', 'ai.embedding.provider') then
    if jsonb_typeof(new.value) <> 'string' or v_text not in ('moonshot', 'zhipu', 'openai') then
      raise exception '% must be "moonshot", "zhipu" or "openai"', new.key using errcode = '22023';
    end if;

  elsif new.key in ('ai.chat_model.moonshot', 'ai.chat_model.zhipu', 'ai.chat_model.openai',
                    'ai.vision_model.moonshot', 'ai.vision_model.zhipu', 'ai.vision_model.openai',
                    'ai.embedding.model') then
    if jsonb_typeof(new.value) <> 'string' or length(btrim(coalesce(v_text, ''))) = 0 then
      raise exception '% must be a non-empty string', new.key using errcode = '22023';
    end if;

  elsif new.key in ('ai.embedding.dim',
                    'ai.limits.requests_per_user_per_hour',
                    'ai.limits.tokens_per_user_per_day',
                    'ai.limits.tokens_global_per_day',
                    'ai.classify.batch_size') then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception '% must be a positive integer', new.key using errcode = '22023';
    end if;
    v_num := v_text::numeric;
    if v_num <= 0 or v_num <> floor(v_num) then
      raise exception '% must be a positive integer', new.key using errcode = '22023';
    end if;

  elsif new.key = 'ai.classify.max_file_mb' then
    if jsonb_typeof(new.value) <> 'number' or v_text::numeric <= 0 then
      raise exception '% must be a positive number', new.key using errcode = '22023';
    end if;

  elsif new.key like 'ai.%' then
    raise exception 'unknown ai.* setting key: % (add it to validate_app_setting in a migration)', new.key
      using errcode = '22023';
  end if;

  return new;
end;
$$;
