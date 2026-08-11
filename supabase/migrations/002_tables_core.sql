-- =============================================================================
-- 002_tables_core.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- Core operational tables: identity, people, platforms, time, money-in,
-- assignments, documents, sharing, audit, settings, and the share rate-limit
-- counter table.
--
-- Source of truth: docs/04-database-erd.md §4.1–4.8 and §4.13–4.18, plus the
-- index plan in §8. RLS is enabled in 008; no policies are created here, so any
-- table left behind by a partial apply is deny-all rather than open.
--
-- Deliberate deviations from docs/04, each necessary and noted inline:
--   * invitations.invited_by is NULLABLE (NULL = system bootstrap) — settled
--     build decision so the bootstrap-admin Edge Function can seed the first
--     Super Admin invitation before any profile exists.
--   * share_rate_limits is new (docs/06 §5.6 records the Postgres-backed
--     counter as an implementation option; this is that option).
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- profiles — 1:1 extension of auth.users (04 §4.1)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  role            public.user_role   not null default 'model',
  full_name       text               not null,
  email           extensions.citext  not null,
  phone           text,
  status          public.user_status not null default 'invited',
  deactivated_at  timestamptz,
  created_at      timestamptz        not null default now(),
  updated_at      timestamptz        not null default now(),
  constraint profiles_email_key unique (email)
);

comment on table public.profiles is
  'Application identity for every auth.users row. Created by handle_new_user() from a pending invitation. Role changes only via the guarded service-role server path.';

-- Exactly one Super Admin, enforced by the database (03 §2.2): every
-- super_admin row indexes the same constant, so a second one collides.
create unique index if not exists one_super_admin
  on public.profiles ((true))
  where role = 'super_admin';

-- -----------------------------------------------------------------------------
-- models — model business records (04 §4.2)
-- -----------------------------------------------------------------------------
create table if not exists public.models (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid unique references public.profiles (id) on delete set null,
  stage_name         text not null,
  legal_name         text not null,
  date_of_birth      date not null,
  email              text,
  phone              text,
  country            char(2),
  start_date         date,
  status             public.model_status not null default 'active',
  commission_percent numeric(5,2) not null,
  payment_details    jsonb,
  notes              text,
  created_by         uuid not null references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint models_age_gate_chk        check (date_of_birth <= (current_date - interval '18 years')),
  constraint models_commission_pct_chk  check (commission_percent >= 0 and commission_percent <= 100)
);

comment on column public.models.commission_percent is
  'LEGACY studio-cut display default. Superseded by commission_schemes for all ledger math (docs/09-accounting.md §4).';
comment on column public.models.payment_details is
  'PII. Encrypting via Vault/pgsodium is an open decision (docs/04-database-erd.md §4.2).';

create index if not exists models_profile_id_idx on public.models (profile_id);
create index if not exists models_created_by_idx on public.models (created_by);
create index if not exists models_status_idx     on public.models (status);

-- -----------------------------------------------------------------------------
-- operators — operator business records (04 §4.3)
-- -----------------------------------------------------------------------------
create table if not exists public.operators (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid unique references public.profiles (id) on delete set null,
  display_name    text not null,
  legal_name      text not null,
  email           text,
  phone           text,
  country         char(2),
  start_date      date,
  status          public.model_status not null default 'active',
  payment_details jsonb,
  notes           text,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists operators_profile_id_idx on public.operators (profile_id);
create index if not exists operators_created_by_idx on public.operators (created_by);
create index if not exists operators_status_idx     on public.operators (status);

-- -----------------------------------------------------------------------------
-- invitations — role-assignment intent (04 §4.17)
-- -----------------------------------------------------------------------------
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       extensions.citext not null,
  role        public.user_role  not null,
  model_id    uuid references public.models (id)    on delete set null,
  operator_id uuid references public.operators (id) on delete set null,
  status      public.invitation_status not null default 'pending',
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  invited_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  constraint invitations_single_link_chk check (not (model_id is not null and operator_id is not null))
);

comment on column public.invitations.invited_by is
  'NULL = system bootstrap (the first Super Admin invitation, created by the bootstrap-admin Edge Function before any profile exists).';

-- One live invitation per address (04 §8).
create unique index if not exists invitations_pending_email
  on public.invitations (email)
  where status = 'pending';

create index if not exists invitations_invited_by_idx  on public.invitations (invited_by);
create index if not exists invitations_model_id_idx    on public.invitations (model_id);
create index if not exists invitations_operator_id_idx on public.invitations (operator_id);

-- -----------------------------------------------------------------------------
-- platforms — lookup (04 §4.4)
-- -----------------------------------------------------------------------------
create table if not exists public.platforms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  website_url text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- platform_accounts — a model's account on a platform (04 §4.5)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_accounts (
  id                   uuid primary key default gen_random_uuid(),
  model_id             uuid not null references public.models (id)    on delete cascade,
  platform_id          uuid not null references public.platforms (id) on delete restrict,
  username             text not null,
  status               public.account_status not null default 'active',
  platform_fee_percent numeric(5,2),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint platform_accounts_fee_pct_chk
    check (platform_fee_percent is null or (platform_fee_percent >= 0 and platform_fee_percent <= 100)),
  constraint platform_accounts_unique unique (model_id, platform_id, username)
);

create index if not exists platform_accounts_model_id_idx    on public.platform_accounts (model_id);
create index if not exists platform_accounts_platform_id_idx on public.platform_accounts (platform_id);

-- -----------------------------------------------------------------------------
-- work_sessions — time tracking, the HOURS source of truth (04 §4.6)
-- -----------------------------------------------------------------------------
create table if not exists public.work_sessions (
  id                  uuid primary key default gen_random_uuid(),
  model_id            uuid not null references public.models (id) on delete cascade,
  platform_account_id uuid not null references public.platform_accounts (id) on delete restrict,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  -- Never written directly; NULL while a session is open.
  duration_minutes    integer generated always as
                        (floor(extract(epoch from (ended_at - started_at)) / 60)::integer) stored,
  gross_earnings      numeric(12,2) not null default 0,
  currency            char(3) not null default 'USD',
  source              public.entry_source not null default 'manual',
  entered_by          uuid not null references public.profiles (id),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint work_sessions_interval_chk check (ended_at is null or ended_at > started_at),
  constraint work_sessions_gross_chk    check (gross_earnings >= 0)
);

create index if not exists work_sessions_model_started      on public.work_sessions (model_id, started_at);
create index if not exists work_sessions_account_idx        on public.work_sessions (platform_account_id);
create index if not exists work_sessions_entered_by_idx     on public.work_sessions (entered_by);

-- -----------------------------------------------------------------------------
-- earnings — money per platform statement period, the MONEY source of truth (04 §4.7)
-- -----------------------------------------------------------------------------
create table if not exists public.earnings (
  id                  uuid primary key default gen_random_uuid(),
  model_id            uuid not null references public.models (id) on delete cascade,
  platform_account_id uuid not null references public.platform_accounts (id) on delete restrict,
  period_start        date not null,
  period_end          date not null,
  gross_amount        numeric(12,2) not null,
  platform_fee_amount numeric(12,2) not null default 0,
  net_amount          numeric(12,2) not null,
  currency            char(3) not null default 'USD',
  source              public.entry_source not null default 'manual',
  entered_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint earnings_period_chk     check (period_end >= period_start),
  constraint earnings_gross_chk      check (gross_amount >= 0),
  constraint earnings_fee_chk        check (platform_fee_amount >= 0),
  constraint earnings_stmt_unique    unique (platform_account_id, period_start, period_end)
);

create index if not exists earnings_model_period  on public.earnings (model_id, period_start);
create index if not exists earnings_account_idx   on public.earnings (platform_account_id);
create index if not exists earnings_entered_by_idx on public.earnings (entered_by);
create index if not exists earnings_period_end_idx on public.earnings (period_end);

-- -----------------------------------------------------------------------------
-- operator_assignments — M:N operator <-> model, with period (04 §4.8)
-- -----------------------------------------------------------------------------
-- The EXCLUDE constraint prevents the same operator being assigned to the same
-- model over overlapping periods (requires btree_gist for the `=` parts).
-- Ranges are inclusive on both ends ('[]'), matching the resolution rule used by
-- fn_generate_earning_shares: a successor assignment starts at assigned_to + 1.
-- The complementary per-model "pool shares sum to <= 100" rule is cross-row and
-- is enforced by the check_operator_pool trigger in 007.
create table if not exists public.operator_assignments (
  id                  uuid primary key default gen_random_uuid(),
  operator_id         uuid not null references public.operators (id) on delete restrict,
  model_id            uuid not null references public.models (id)    on delete cascade,
  pool_share_percent  numeric(5,2) not null default 100,
  assigned_from       date not null,
  assigned_to         date,
  notes               text,
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now(),
  constraint operator_assignments_share_chk check (pool_share_percent >= 0 and pool_share_percent <= 100),
  constraint operator_assignments_range_chk check (assigned_to is null or assigned_to > assigned_from),
  constraint operator_assignments_no_overlap exclude using gist (
    operator_id with =,
    model_id    with =,
    daterange(assigned_from, assigned_to, '[]') with &&
  )
);

create index if not exists operator_assignments_model_from on public.operator_assignments (model_id, assigned_from);
create index if not exists operator_assignments_operator_idx on public.operator_assignments (operator_id);
create index if not exists operator_assignments_created_by_idx on public.operator_assignments (created_by);

-- -----------------------------------------------------------------------------
-- documents — compliance & identity document metadata (04 §4.13)
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  model_id        uuid not null references public.models (id) on delete restrict,
  doc_type        public.document_type not null,
  title           text not null,
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null,
  file_size_bytes bigint not null,
  sha256          text,
  issued_date     date,
  expires_at      date,
  is_archived     boolean not null default false,
  uploaded_by     uuid not null references public.profiles (id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint documents_size_chk check (file_size_bytes > 0)
);

comment on column public.documents.expires_at is
  'Compliance status is derived in v_document_compliance, never stored (docs/06 §4).';

create index if not exists documents_model_id_idx    on public.documents (model_id);
create index if not exists documents_expires         on public.documents (expires_at);
create index if not exists documents_uploaded_by_idx on public.documents (uploaded_by);

-- -----------------------------------------------------------------------------
-- document_shares — revocable external share tokens (04 §4.14)
-- -----------------------------------------------------------------------------
create table if not exists public.document_shares (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  token_hash      text not null,
  token_prefix    text not null,
  recipient_label text,
  expires_at      timestamptz not null,
  max_views       integer,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id),
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  constraint document_shares_max_views_chk  check (max_views is null or max_views > 0),
  constraint document_shares_view_count_chk check (view_count >= 0)
);

comment on column public.document_shares.token_hash is
  'SHA-256 of the raw token. The raw token is returned to the creator once and never stored (docs/06 §5.1).';

create unique index if not exists document_shares_token_hash on public.document_shares (token_hash);
create index if not exists document_shares_document_id_idx  on public.document_shares (document_id);
create index if not exists document_shares_created_by_idx   on public.document_shares (created_by);
create index if not exists document_shares_revoked_by_idx   on public.document_shares (revoked_by);

-- -----------------------------------------------------------------------------
-- document_share_views — append-only external view audit (04 §4.15)
-- -----------------------------------------------------------------------------
create table if not exists public.document_share_views (
  id         bigint generated always as identity primary key,
  share_id   uuid not null references public.document_shares (id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  ip_hash    text,
  user_agent text
);

comment on column public.document_share_views.ip_hash is
  'Salted hash. The raw IP is never stored.';

create index if not exists document_share_views_share_idx on public.document_share_views (share_id, viewed_at);

-- -----------------------------------------------------------------------------
-- audit_log — append-only system audit trail (04 §4.16)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users (id),
  actor_role  public.user_role,
  action      text not null,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. No UPDATE/DELETE policy exists for any role, including super_admin. Written by SECURITY DEFINER triggers and service-role server paths.';

create index if not exists audit_log_created_idx  on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx    on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_action_idx   on public.audit_log (action, created_at desc);
create index if not exists audit_log_entity_idx   on public.audit_log (entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- app_settings — typed global configuration (04 §4.18)
-- -----------------------------------------------------------------------------
-- Rule: secrets never live here. API keys live in server env vars only.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint app_settings_key_chk check (key ~ '^[a-z][a-z0-9_.]*$')
);

comment on column public.app_settings.updated_by is 'NULL = migration seed.';

create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);

-- -----------------------------------------------------------------------------
-- share_rate_limits — Postgres-backed token bucket for the share-view Edge
-- Function (docs/06 §5.6). Written by the service role only; no policies exist,
-- so no client role can read or write it.
-- -----------------------------------------------------------------------------
create table if not exists public.share_rate_limits (
  ip_hash       text not null,
  window_start  timestamptz not null,
  request_count integer not null default 0,
  primary key (ip_hash, window_start)
);

create index if not exists share_rate_limits_window_idx on public.share_rate_limits (window_start);
