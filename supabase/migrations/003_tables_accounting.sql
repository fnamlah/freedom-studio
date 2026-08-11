-- =============================================================================
-- 003_tables_accounting.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The money tables: commission schemes (split rules), the append-only payee
-- ledger, generalized payouts, and forecast snapshots.
--
-- Source of truth: docs/04-database-erd.md §4.9–4.12 and docs/09-accounting.md.
--
-- Deliberate deviations, each necessary and noted inline:
--   * commission_schemes.created_by is NULLABLE (NULL = migration seed). docs/04
--     types it NOT NULL, but docs/09 §4.1 also requires exactly one default
--     scheme to exist from provisioning onward — and at migration time no
--     profiles row exists yet. Same convention as app_settings.updated_by.
--   * forecast_snapshots' "one snapshot per scope per day" index normalizes
--     generated_at to UTC before casting to date: `generated_at::date` alone is
--     STABLE (TimeZone-dependent) and Postgres refuses it in an index.
--   * ledger_entries carries a partial unique index on
--     (earning_id, payee_type, payee_id) WHERE entry_type = 'earning_share',
--     which makes fn_generate_earning_shares idempotent by construction rather
--     than by read-then-write (docs/09 §5.3), and race-safe.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- commission_schemes — split rules (04 §4.9, 09 §4)
-- -----------------------------------------------------------------------------
-- Scope is account-specific, model-specific, or default (both NULL); never both.
-- The GiST exclusion constraint keys on the coalesced scope columns, so at most
-- one scheme per scope can be effective on any date and resolution is always
-- deterministic. Effective ranges are inclusive on both ends ('[]'), matching
-- the resolution predicate used by fn_generate_earning_shares in 009.
create table if not exists public.commission_schemes (
  id                  uuid primary key default gen_random_uuid(),
  model_id            uuid references public.models (id),
  platform_account_id uuid references public.platform_accounts (id),
  model_percent       numeric(5,2) not null,
  operator_percent    numeric(5,2) not null,
  studio_percent      numeric(5,2) not null,
  effective_from      date not null,
  effective_to        date,
  notes               text,
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  constraint commission_schemes_scope_chk
    check (not (model_id is not null and platform_account_id is not null)),
  constraint commission_schemes_model_pct_chk    check (model_percent    >= 0 and model_percent    <= 100),
  constraint commission_schemes_operator_pct_chk check (operator_percent >= 0 and operator_percent <= 100),
  constraint commission_schemes_studio_pct_chk   check (studio_percent   >= 0 and studio_percent   <= 100),
  constraint commission_schemes_sum_chk
    check (model_percent + operator_percent + studio_percent = 100),
  constraint commission_schemes_range_chk
    check (effective_to is null or effective_to > effective_from),
  constraint commission_schemes_no_overlap exclude using gist (
    (coalesce(model_id,            '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(platform_account_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

comment on column public.commission_schemes.operator_percent is
  'The operator POOL, weighted per assignment by operator_assignments.pool_share_percent (docs/09 §4.3).';
comment on column public.commission_schemes.created_by is 'NULL = migration seed (the default scheme).';

create index if not exists commission_schemes_model_idx      on public.commission_schemes (model_id);
create index if not exists commission_schemes_account_idx    on public.commission_schemes (platform_account_id);
create index if not exists commission_schemes_created_by_idx on public.commission_schemes (created_by);
create index if not exists commission_schemes_effective_idx  on public.commission_schemes (effective_from, effective_to);

-- Exactly one default scheme (both scope columns NULL) must exist at all times;
-- the exclusion constraint already prevents a second *overlapping* default.
create unique index if not exists commission_schemes_one_default
  on public.commission_schemes (effective_from)
  where model_id is null and platform_account_id is null;

-- -----------------------------------------------------------------------------
-- payouts — generalized payee payouts, the maker-checker unit (04 §4.11, 09 §6)
-- -----------------------------------------------------------------------------
-- payee_id is polymorphic by payee_type and has no declarative FK; the
-- validate_payout_payee trigger (007) is the mitigation.
create table if not exists public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  payee_type         public.payee_type not null,
  payee_id           uuid not null,
  period_start       date not null,
  period_end         date not null,
  gross_amount       numeric(12,2) not null,
  studio_fee_amount  numeric(12,2) not null default 0,
  deductions         numeric(12,2) not null default 0,
  net_amount         numeric(12,2) not null,
  currency           char(3) not null default 'USD',
  status             public.payout_status not null default 'pending',
  payment_method     text,
  reference          text,
  paid_at            timestamptz,
  created_by         uuid not null references public.profiles (id),
  approved_by        uuid references public.profiles (id),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payouts_period_chk check (period_end >= period_start)
);

comment on table public.payouts is
  'Status transitions are role-gated: only super_admin may write ''approved''; finance may move ''approved'' -> ''paid''. Enforced by RLS WITH CHECK (008) plus the enforce_payout_transition trigger (007).';

create index if not exists payouts_payee_idx       on public.payouts (payee_type, payee_id, period_end);
create index if not exists payouts_status_idx      on public.payouts (status);
create index if not exists payouts_created_by_idx  on public.payouts (created_by);
create index if not exists payouts_approved_by_idx on public.payouts (approved_by);

-- -----------------------------------------------------------------------------
-- ledger_entries — append-only, double-entry-lite journal (04 §4.10, 09 §5)
-- -----------------------------------------------------------------------------
-- No role, including super_admin, holds UPDATE or DELETE (see 008: the absence
-- of a policy IS the enforcement). Corrections are reversing adjustment entries.
-- Sign convention: earning_share and positive adjustments credit the payee;
-- deduction and payout_settlement are negative. Balance = SUM(amount).
create table if not exists public.ledger_entries (
  id                   bigint generated always as identity primary key,
  payee_type           public.payee_type not null,
  payee_id             uuid not null,
  entry_type           public.ledger_entry_type not null,
  amount               numeric(12,2) not null,
  currency             char(3) not null default 'USD',
  period_start         date,
  period_end           date,
  earning_id           uuid references public.earnings (id),
  payout_id            uuid references public.payouts (id),
  commission_scheme_id uuid references public.commission_schemes (id),
  description          text,
  created_by           uuid not null references public.profiles (id),
  created_at           timestamptz not null default now(),
  constraint ledger_entries_amount_chk check (amount <> 0),
  constraint ledger_entries_period_chk check (period_end is null or period_start is null or period_end >= period_start)
);

create index if not exists ledger_payee_created      on public.ledger_entries (payee_type, payee_id, created_at);
create index if not exists ledger_entries_earning_idx on public.ledger_entries (earning_id);
create index if not exists ledger_entries_payout_idx  on public.ledger_entries (payout_id);
create index if not exists ledger_entries_scheme_idx  on public.ledger_entries (commission_scheme_id);
create index if not exists ledger_entries_created_by_idx on public.ledger_entries (created_by);
create index if not exists ledger_entries_type_period_idx on public.ledger_entries (entry_type, period_end);

-- Idempotency key for fn_generate_earning_shares: one earning_share per
-- (earning, payee). A re-run inserts only what is missing (docs/09 §5.3).
create unique index if not exists ledger_earning_share_unique
  on public.ledger_entries (earning_id, payee_type, payee_id)
  where entry_type = 'earning_share' and earning_id is not null;

-- One settlement entry per payout — the paid-transition trigger is its only writer.
create unique index if not exists ledger_payout_settlement_unique
  on public.ledger_entries (payout_id)
  where entry_type = 'payout_settlement' and payout_id is not null;

-- -----------------------------------------------------------------------------
-- forecast_snapshots — remembered predictions for accuracy tracking (04 §4.12)
-- -----------------------------------------------------------------------------
-- This table is NOT a cache: live projections are computed on read by
-- v_earnings_forecast / fn_forecast. Snapshots exist only so error can be
-- measured later (docs/09 §8.2).
create table if not exists public.forecast_snapshots (
  id            uuid primary key default gen_random_uuid(),
  generated_at  timestamptz not null default now(),
  generated_by  uuid references public.profiles (id),
  target_month  date not null,
  model_id      uuid references public.models (id),
  platform_id   uuid references public.platforms (id),
  predicted_net numeric(12,2) not null,
  method        text not null default 'ma3_growth',
  params        jsonb not null default '{}'::jsonb
);

comment on column public.forecast_snapshots.generated_by is 'NULL = scheduled job.';

-- One snapshot per scope per day. NULLs never collide in a plain unique index,
-- hence the zero-UUID sentinels; generated_at is normalized to UTC first so the
-- expression is IMMUTABLE and therefore indexable.
create unique index if not exists forecast_snapshots_scope_day
  on public.forecast_snapshots (
    target_month,
    (coalesce(model_id,    '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(platform_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (((generated_at at time zone 'UTC'))::date)
  );

create index if not exists forecast_snapshots_target_idx    on public.forecast_snapshots (target_month);
create index if not exists forecast_snapshots_model_idx     on public.forecast_snapshots (model_id);
create index if not exists forecast_snapshots_platform_idx  on public.forecast_snapshots (platform_id);
create index if not exists forecast_snapshots_generated_by_idx on public.forecast_snapshots (generated_by);
