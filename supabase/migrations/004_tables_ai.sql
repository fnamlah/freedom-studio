-- =============================================================================
-- 004_tables_ai.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- AI assistant persistence: conversations, append-only turns, per-request
-- metering, the pgvector store, and stored market reports.
--
-- Source of truth: docs/04-database-erd.md §4.19–4.23 and docs/11-ai-llm.md.
--
-- Note on the ANN index (the one deliberate deviation, explained where it is
-- created): pgvector caps HNSW/IVFFlat indexes at 2000 dimensions for the
-- `vector` type, and the embedding column is vector(2048) by design. The
-- supported way to index >2000 dimensions is an expression index over
-- halfvec(2048) with halfvec_cosine_ops — cosine ordering is preserved, and
-- fn_semantic_search (009) orders by exactly that expression so the index is
-- used. Full-precision cosine similarity is still reported from the vector
-- column itself.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- ai_conversations — chat threads (04 §4.19)
-- -----------------------------------------------------------------------------
-- Own-only for EVERY role including super_admin. SA oversight runs through
-- ai_usage and audit_log, never by reading colleagues' chats (docs/11 §2).
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- ai_messages — conversation turns, redacted forms only (04 §4.20)
-- -----------------------------------------------------------------------------
-- Append-only: no UPDATE or DELETE policy exists for any role. content and
-- tool_result store the redacted, provider-bound projection, so the log doubles
-- as an egress audit (docs/11 §5).
create table if not exists public.ai_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id),
  role            public.ai_message_role not null,
  content         text,
  tool_name       text,
  tool_args       jsonb,
  tool_result     jsonb,
  provider        public.ai_provider,
  model           text,
  created_at      timestamptz not null default now(),
  constraint ai_messages_tool_name_chk check (role <> 'tool' or tool_name is not null)
);

create index if not exists ai_messages_conversation on public.ai_messages (conversation_id, id);
create index if not exists ai_messages_user         on public.ai_messages (user_id);

-- -----------------------------------------------------------------------------
-- ai_usage — per-request metering (04 §4.21, 11 §8)
-- -----------------------------------------------------------------------------
-- Inserted by the gateway via the service role only; no client write path.
-- est_cost_usd deliberately deviates from the numeric(12,2) money convention:
-- per-token unit prices are fractions of a cent.
create table if not exists public.ai_usage (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles (id),
  conversation_id   uuid references public.ai_conversations (id) on delete set null,
  request_kind      public.ai_request_kind not null,
  provider          public.ai_provider not null,
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  tool_call_count   integer not null default 0,
  est_cost_usd      numeric(10,6),
  duration_ms       integer,
  status            text not null default 'ok',
  created_at        timestamptz not null default now(),
  constraint ai_usage_status_chk check (status in ('ok', 'error', 'rate_limited', 'budget_exceeded')),
  constraint ai_usage_tokens_chk check (prompt_tokens >= 0 and completion_tokens >= 0 and tool_call_count >= 0)
);

create index if not exists ai_usage_user_created on public.ai_usage (user_id, created_at);
create index if not exists ai_usage_created      on public.ai_usage (created_at);
create index if not exists ai_usage_conversation_idx on public.ai_usage (conversation_id);

-- -----------------------------------------------------------------------------
-- embeddings — pgvector semantic-search store (04 §4.22, 11 §6)
-- -----------------------------------------------------------------------------
-- source_id is polymorphic by source_type and has no declarative FK; model_id /
-- operator_id are the RLS scoping FKs. `content` is the already-redacted text
-- that was actually embedded, so re-surfacing it in results is safe by
-- construction. Written only by the service-role indexing job.
create table if not exists public.embeddings (
  id              uuid primary key default gen_random_uuid(),
  source_type     public.embedding_source not null,
  source_id       uuid not null,
  model_id        uuid references public.models (id)    on delete cascade,
  operator_id     uuid references public.operators (id) on delete cascade,
  content         text not null,
  content_hash    text not null,
  embedding       extensions.vector(2048) not null,
  embedding_model text not null,
  embedded_at     timestamptz not null default now(),
  constraint embeddings_model_scope_chk
    check ((source_type in ('model_note', 'document_meta')) = (model_id is not null)),
  constraint embeddings_operator_scope_chk
    check ((source_type = 'operator_note') = (operator_id is not null)),
  constraint embeddings_source_unique unique (source_type, source_id, embedding_model)
);

create index if not exists embeddings_model_idx     on public.embeddings (model_id);
create index if not exists embeddings_operator_idx  on public.embeddings (operator_id);
create index if not exists embeddings_source_idx    on public.embeddings (source_type, source_id);
create index if not exists embeddings_model_name_idx on public.embeddings (embedding_model);

-- Approximate-nearest-neighbour index for fn_semantic_search. See the header
-- note: halfvec(2048) is the supported path above pgvector's 2000-dimension
-- index cap. Guarded so that an older pgvector (no halfvec) degrades to an exact
-- scan instead of failing the whole migration.
do $$
begin
  begin
    create index if not exists embeddings_hnsw
      on public.embeddings
      using hnsw ((embedding::extensions.halfvec(2048)) extensions.halfvec_cosine_ops);
  exception
    when others then
      raise warning 'embeddings_hnsw not created (%). Semantic search falls back to an exact scan; create the index once pgvector >= 0.7 is available.', sqlerrm;
  end;
end
$$;

-- -----------------------------------------------------------------------------
-- ai_reports — stored AI market reports (04 §4.23, 11 §7)
-- -----------------------------------------------------------------------------
-- Readable by super_admin and finance only: the inputs include SA/FIN-only
-- analytics (split distribution, balances, forecast accuracy).
create table if not exists public.ai_reports (
  id           uuid primary key default gen_random_uuid(),
  report_month date not null,
  title        text not null,
  content_md   text not null,
  provider     public.ai_provider not null,
  model        text not null,
  params       jsonb not null default '{}'::jsonb,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now()
);

create index if not exists ai_reports_month_idx      on public.ai_reports (report_month desc);
create index if not exists ai_reports_created_by_idx on public.ai_reports (created_by);
