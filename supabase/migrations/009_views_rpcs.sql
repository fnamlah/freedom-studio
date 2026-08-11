-- =============================================================================
-- 009_views_rpcs.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The analytics layer plus the two accounting write RPCs.
--
-- Source of truth: docs/07-analytics.md §2 (view catalogue) and §3 (RPC
-- catalogue), docs/09-accounting.md §5.3/§7/§8 (share generation, statements,
-- forecasting), docs/11-ai-llm.md §6.3 (semantic search), docs/04 §7.3 (the
-- access-shaping views).
--
-- THE design principle: every object here is SECURITY INVOKER. Views carry
-- `with (security_invoker = on)`; functions are declared `security invoker`. A
-- single set of objects therefore serves all five roles, and Row Level Security
-- remains the sole authority over what each caller sees. The worst a buggy view
-- can do is show the caller rows RLS already allows them to read.
--
-- Two consequences worth stating, because they look like bugs and are not:
--   * Aggregates are computed over the rows VISIBLE TO THE CALLER. A model's
--     "share by platform" denominator is their own accounts — which is exactly
--     the intended scope — and a model is simply never shown the by-model pie.
--   * Percentage outputs are clamped to +/- 999.99 before they hit their
--     numeric(5,2) result columns. Without the clamp a near-zero denominator
--     raises "numeric field overflow" at query time and takes a dashboard down.
-- =============================================================================

set search_path = public, extensions;

-- =============================================================================
-- 1. Forecasting core (docs/09 §8.1)
-- -----------------------------------------------------------------------------
-- Method 'ma3_growth', reproducible by hand from statement data:
--   1. monthly net per (model, platform), complete months only
--   2. base   = 3-month moving average of the most recent complete months
--   3. growth = mean trailing MoM growth over that window, clamped to +/-25%
--   4. month n ahead = base * growth^n  (compounded once per month ahead)
-- Deliberately no ML: every intermediate is inspectable, which is worth more
-- here than marginal accuracy from an opaque model.
-- =============================================================================
create or replace function public.fn_forecast(p_months_ahead integer default 3)
returns table (
  target_month  date,
  model_id      uuid,
  platform_id   uuid,
  predicted_net numeric(12,2)
)
language sql
stable
security invoker
set search_path = ''
as $$
  with monthly as (
    select e.model_id                             as m_id,
           pa.platform_id                         as p_id,
           (date_trunc('month', e.period_end))::date as month,
           sum(e.net_amount)                      as net
    from public.earnings e
    join public.platform_accounts pa on pa.id = e.platform_account_id
    where e.period_end < (date_trunc('month', current_date))::date
    group by 1, 2, 3
  ),
  ranked as (
    select m.m_id, m.p_id, m.month, m.net,
           row_number() over (partition by m.m_id, m.p_id order by m.month desc) as rn,
           lag(m.net)   over (partition by m.m_id, m.p_id order by m.month)      as prev_net
    from monthly m
  ),
  windowed as (
    select r.m_id, r.p_id,
           avg(r.net) as ma3,
           coalesce(
             avg(r.net / nullif(r.prev_net, 0))
               filter (where r.prev_net is not null and r.prev_net > 0),
             1
           ) as raw_growth
    from ranked r
    where r.rn <= 3
    group by 1, 2
  ),
  scoped as (
    select w.m_id, w.p_id, w.ma3,
           least(greatest(w.raw_growth, 0.75), 1.25) as growth
    from windowed w
  ),
  horizon as (
    select generate_series(1, greatest(coalesce(p_months_ahead, 3), 1)) as n
  )
  select (date_trunc('month', current_date) + (h.n * interval '1 month'))::date,
         s.m_id,
         s.p_id,
         round(s.ma3 * power(s.growth, h.n), 2)::numeric(12,2)
  from scoped s
  cross join horizon h
  order by 1, 2, 3;
$$;

comment on function public.fn_forecast(integer) is
  'Live projection (docs/09 §8). Never reads forecast_snapshots: snapshots are for accuracy measurement only, never a cache.';

-- =============================================================================
-- 2. Access-shaping views (docs/04 §7.3)
-- -----------------------------------------------------------------------------
-- RLS restricts rows, not columns. These views are how sensitive columns
-- (legal_name, date_of_birth, payment_details, internal notes) stay out of
-- non-admin reads; the application must query them rather than the base tables.
-- =============================================================================
drop view if exists public.v_my_model cascade;
create view public.v_my_model with (security_invoker = on) as
  select m.id,
         m.stage_name,
         m.status,
         m.start_date,
         m.country,
         m.email,
         m.phone,
         m.commission_percent
  from public.models m
  where m.profile_id = auth.uid();

drop view if exists public.v_my_operator cascade;
create view public.v_my_operator with (security_invoker = on) as
  select o.id,
         o.display_name,
         o.status,
         o.start_date,
         o.country,
         o.email,
         o.phone
  from public.operators o
  where o.profile_id = auth.uid();

-- Finance's entire people-visibility surface: an id and a pseudonym.
drop view if exists public.v_model_directory cascade;
create view public.v_model_directory with (security_invoker = on) as
  select m.id, m.stage_name from public.models m;

drop view if exists public.v_operator_directory cascade;
create view public.v_operator_directory with (security_invoker = on) as
  select o.id, o.display_name from public.operators o;

-- =============================================================================
-- 3. Analytics views (docs/07 §2)
-- =============================================================================

-- Core earnings trend series -------------------------------------------------
drop view if exists public.v_earnings_monthly cascade;
create view public.v_earnings_monthly with (security_invoker = on) as
  select e.model_id,
         pa.platform_id,
         (date_trunc('month', e.period_end))::date as month,
         sum(e.gross_amount)::numeric(12,2)        as gross_amount,
         sum(e.net_amount)::numeric(12,2)          as net_amount
  from public.earnings e
  join public.platform_accounts pa on pa.id = e.platform_account_id
  group by e.model_id, pa.platform_id, (date_trunc('month', e.period_end))::date;

-- Pie input. share_percent is computed over rows visible to the caller, so it is
-- meaningful for SA/MGR and trivially 100% for a model — who is not shown it.
drop view if exists public.v_earnings_share_by_model cascade;
create view public.v_earnings_share_by_model with (security_invoker = on) as
  with base as (
    select (date_trunc('month', e.period_end))::date as month,
           e.model_id,
           sum(e.net_amount) as net
    from public.earnings e
    group by 1, 2
  )
  select b.month,
         b.model_id,
         m.stage_name,
         b.net::numeric(12,2) as net_amount,
         (case
            when sum(b.net) over (partition by b.month) <> 0
            then least(greatest(round(b.net * 100 / sum(b.net) over (partition by b.month), 2), -999.99), 999.99)
            else 0
          end)::numeric(5,2) as share_percent
  from base b
  left join public.models m on m.id = b.model_id;

drop view if exists public.v_earnings_share_by_platform cascade;
create view public.v_earnings_share_by_platform with (security_invoker = on) as
  with base as (
    select (date_trunc('month', e.period_end))::date as month,
           pa.platform_id,
           sum(e.net_amount) as net
    from public.earnings e
    join public.platform_accounts pa on pa.id = e.platform_account_id
    group by 1, 2
  )
  select b.month,
         b.platform_id,
         pl.name as platform_name,
         b.net::numeric(12,2) as net_amount,
         (case
            when sum(b.net) over (partition by b.month) <> 0
            then least(greatest(round(b.net * 100 / sum(b.net) over (partition by b.month), 2), -999.99), 999.99)
            else 0
          end)::numeric(5,2) as share_percent
  from base b
  left join public.platforms pl on pl.id = b.platform_id;

-- Hours source of truth is work_sessions, never earnings (docs/04 §4.6).
drop view if exists public.v_sessions_hours_monthly cascade;
create view public.v_sessions_hours_monthly with (security_invoker = on) as
  select ws.model_id,
         (date_trunc('month', ws.started_at))::date as month,
         round(coalesce(sum(ws.duration_minutes), 0) / 60.0, 2) as hours,
         count(*)::integer as session_count
  from public.work_sessions ws
  group by ws.model_id, (date_trunc('month', ws.started_at))::date;

drop view if exists public.v_payout_history cascade;
create view public.v_payout_history with (security_invoker = on) as
  select p.id as payout_id,
         p.payee_type,
         p.payee_id,
         coalesce(m.stage_name, o.display_name) as payee_name,
         p.period_start,
         p.period_end,
         p.net_amount,
         p.currency,
         p.status,
         p.paid_at
  from public.payouts p
  left join public.models    m on p.payee_type = 'model'    and m.id = p.payee_id
  left join public.operators o on p.payee_type = 'operator' and o.id = p.payee_id;

-- Compliance status is DERIVED, never stored (docs/06 §4).
drop view if exists public.v_document_compliance cascade;
create view public.v_document_compliance with (security_invoker = on) as
  select d.id as document_id,
         d.model_id,
         d.doc_type,
         d.title,
         d.expires_at,
         case
           when d.expires_at is null            then 'valid'
           when d.expires_at < current_date     then 'expired'
           when d.expires_at <= current_date + 30 then 'expiring'
           else 'valid'
         end as status
  from public.documents d
  where d.is_archived = false;

drop view if exists public.v_model_compliance_summary cascade;
create view public.v_model_compliance_summary with (security_invoker = on) as
  select m.id as model_id,
         m.stage_name,
         count(*) filter (where c.status = 'valid')::integer    as valid_count,
         count(*) filter (where c.status = 'expiring')::integer as expiring_count,
         count(*) filter (where c.status = 'expired')::integer  as expired_count
  from public.models m
  left join public.v_document_compliance c on c.model_id = m.id
  group by m.id, m.stage_name;

-- balance = SUM(amount) under the sign convention of docs/09 §5.1.
drop view if exists public.v_payee_balances cascade;
create view public.v_payee_balances with (security_invoker = on) as
  select le.payee_type,
         le.payee_id,
         coalesce(m.stage_name, o.display_name) as display_name,
         le.currency,
         sum(le.amount)::numeric(12,2) as balance
  from public.ledger_entries le
  left join public.models    m on le.payee_type = 'model'    and m.id = le.payee_id
  left join public.operators o on le.payee_type = 'operator' and o.id = le.payee_id
  group by le.payee_type, le.payee_id, coalesce(m.stage_name, o.display_name), le.currency;

-- The 'studio' bucket is the RESIDUE of monthly net after the posted model and
-- operator credits — derived, never posted, so studio margin can never drift out
-- of reconciliation with the ledger (docs/09 §1).
drop view if exists public.v_split_distribution cascade;
create view public.v_split_distribution with (security_invoker = on) as
  with net_by_month as (
    select (date_trunc('month', e.period_end))::date as month,
           sum(e.net_amount) as net
    from public.earnings e
    group by 1
  ),
  credits as (
    select (date_trunc('month', coalesce(le.period_end, (le.created_at at time zone 'UTC')::date)))::date as month,
           le.payee_type,
           sum(le.amount) as amount
    from public.ledger_entries le
    where le.entry_type = 'earning_share'
    group by 1, 2
  ),
  months as (
    select n.month from net_by_month n
    union
    select c.month from credits c
  ),
  agg as (
    select mo.month,
           coalesce((select n.net    from net_by_month n where n.month = mo.month), 0) as net,
           coalesce((select c.amount from credits c where c.month = mo.month and c.payee_type = 'model'), 0)    as model_amt,
           coalesce((select c.amount from credits c where c.month = mo.month and c.payee_type = 'operator'), 0) as operator_amt
    from months mo
  )
  select a.month,
         x.bucket,
         x.amount::numeric(12,2) as amount,
         (case
            when a.net <> 0
            then least(greatest(round(x.amount * 100 / a.net, 2), -999.99), 999.99)
            else 0
          end)::numeric(5,2) as share_percent
  from agg a
  cross join lateral (
    values ('model'::text,    a.model_amt),
           ('operator'::text, a.operator_amt),
           ('studio'::text,   a.net - a.model_amt - a.operator_amt)
  ) as x(bucket, amount);

-- Live projection; there is no stored copy of derived money data to go stale.
drop view if exists public.v_earnings_forecast cascade;
create view public.v_earnings_forecast with (security_invoker = on) as
  select f.target_month, f.model_id, f.platform_id, f.predicted_net
  from public.fn_forecast(3) f;

-- Snapshots joined against realized monthly net. model_id IS NULL = studio
-- total; only the platform-agnostic snapshot grain participates, so nothing is
-- double-counted.
drop view if exists public.v_forecast_accuracy cascade;
create view public.v_forecast_accuracy with (security_invoker = on) as
  with snap as (
    select distinct on (fs.target_month, coalesce(fs.model_id, '00000000-0000-0000-0000-000000000000'::uuid))
           fs.target_month,
           fs.model_id,
           fs.predicted_net
    from public.forecast_snapshots fs
    where fs.platform_id is null
    order by fs.target_month,
             coalesce(fs.model_id, '00000000-0000-0000-0000-000000000000'::uuid),
             fs.generated_at
  ),
  actual_by_model as (
    select (date_trunc('month', e.period_end))::date as month,
           e.model_id,
           sum(e.net_amount) as net
    from public.earnings e
    group by 1, 2
  ),
  actual_total as (
    select (date_trunc('month', e.period_end))::date as month,
           sum(e.net_amount) as net
    from public.earnings e
    group by 1
  ),
  joined as (
    select s.target_month,
           s.model_id,
           s.predicted_net,
           coalesce(
             case when s.model_id is null then tot.net else abm.net end,
             0
           )::numeric(12,2) as actual_net
    from snap s
    left join actual_by_model abm on abm.month = s.target_month and abm.model_id = s.model_id
    left join actual_total    tot on tot.month = s.target_month and s.model_id is null
  ),
  err as (
    select j.target_month,
           j.model_id,
           j.predicted_net,
           j.actual_net,
           (j.actual_net - j.predicted_net)::numeric(12,2) as error_amount,
           case when j.actual_net <> 0
                then abs(j.actual_net - j.predicted_net) * 100 / abs(j.actual_net)
           end as err_pct
    from joined j
  ),
  rolled as (
    select e.target_month, e.model_id, e.predicted_net, e.actual_net, e.error_amount, e.err_pct,
           avg(e.err_pct) over (
             partition by e.model_id
             order by e.target_month
             rows between 2 preceding and current row
           ) as mape_raw
    from err e
  )
  -- The percentage columns stay NULL when undefined (actual = 0): least() drops
  -- NULLs, so clamping has to be guarded or an unmeasurable month would report a
  -- confident 999.99% error.
  select r.target_month,
         r.model_id,
         r.predicted_net,
         r.actual_net,
         r.error_amount,
         (case when r.err_pct is null then null
               else least(round(r.err_pct, 2), 999.99) end)::numeric(5,2) as error_percent,
         (case when r.mape_raw is null then null
               else least(round(r.mape_raw, 2), 999.99) end)::numeric(5,2) as rolling_mape
  from rolled r;

-- =============================================================================
-- 4. Read RPCs (docs/07 §3)
-- -----------------------------------------------------------------------------
-- All SECURITY INVOKER and STABLE, with explicit date-range parameters so
-- dashboards never encode period logic client-side.
-- =============================================================================

create or replace function public.fn_earnings_summary(
  p_from     date,
  p_to       date,
  p_group_by text default 'month'
)
returns table (
  group_key    text,
  gross_amount numeric(12,2),
  net_amount   numeric(12,2)
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_group_by is null or p_group_by not in ('model', 'platform', 'week', 'month') then
    raise exception 'p_group_by must be one of model, platform, week, month' using errcode = '22023';
  end if;

  return query
    select k.gk,
           sum(e.gross_amount)::numeric(12,2),
           sum(e.net_amount)::numeric(12,2)
    from public.earnings e
    join public.platform_accounts pa on pa.id = e.platform_account_id
    left join public.models    m  on m.id  = e.model_id
    left join public.platforms pl on pl.id = pa.platform_id
    cross join lateral (
      select case p_group_by
               when 'model'    then coalesce(m.stage_name, e.model_id::text)
               when 'platform' then coalesce(pl.name, pa.platform_id::text)
               when 'week'     then to_char(date_trunc('week',  e.period_end), 'IYYY-"W"IW')
               else                 to_char(date_trunc('month', e.period_end), 'YYYY-MM')
             end as gk
    ) k
    where e.period_end between p_from and p_to
    group by k.gk
    order by k.gk;
end;
$$;

create or replace function public.fn_hours_summary(p_from date, p_to date)
returns table (
  model_id      uuid,
  hours         numeric,
  session_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select ws.model_id,
         round(coalesce(sum(ws.duration_minutes), 0) / 60.0, 2),
         count(*)::integer
  from public.work_sessions ws
  where ws.started_at >= p_from::timestamptz
    and ws.started_at <  (p_to + 1)::timestamptz
  group by ws.model_id
  order by ws.model_id;
$$;

create or replace function public.fn_payout_summary(p_from date, p_to date)
returns table (
  status       public.payout_status,
  payout_count integer,
  total_net    numeric(12,2)
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.status,
         count(*)::integer,
         coalesce(sum(p.net_amount), 0)::numeric(12,2)
  from public.payouts p
  where p.period_end between p_from and p_to
  group by p.status
  order by p.status;
$$;

create or replace function public.fn_compliance_counts()
returns table (
  valid_count    integer,
  expiring_count integer,
  expired_count  integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) filter (where c.status = 'valid')::integer,
         count(*) filter (where c.status = 'expiring')::integer,
         count(*) filter (where c.status = 'expired')::integer
  from public.v_document_compliance c;
$$;

-- Payee statement (docs/09 §7). Three line kinds in order: one 'opening' row,
-- the 'entry' rows with a running balance, one 'closing' row whose `amount` is
-- the period movement and whose `running_balance` is the closing balance.
-- Reproducible forever, because the ledger is append-only.
create or replace function public.fn_payee_statement(
  p_payee_type public.payee_type,
  p_payee_id   uuid,
  p_from       date,
  p_to         date
)
returns table (
  line_type            text,
  entry_id             bigint,
  entry_date           date,
  entry_type           public.ledger_entry_type,
  amount               numeric(12,2),
  currency             char(3),
  description          text,
  earning_id           uuid,
  payout_id            uuid,
  commission_scheme_id uuid,
  running_balance      numeric(12,2)
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_open  numeric(12,2);
  v_close numeric(12,2);
begin
  select coalesce(sum(le.amount), 0)::numeric(12,2)
    into v_open
  from public.ledger_entries le
  where le.payee_type = p_payee_type
    and le.payee_id   = p_payee_id
    and (le.created_at at time zone 'UTC')::date < p_from;

  return query
    select 'opening'::text, null::bigint, p_from, null::public.ledger_entry_type,
           v_open, null::char(3), 'Opening balance'::text,
           null::uuid, null::uuid, null::uuid, v_open;

  return query
    select 'entry'::text,
           le.id,
           (le.created_at at time zone 'UTC')::date,
           le.entry_type,
           le.amount,
           le.currency,
           le.description,
           le.earning_id,
           le.payout_id,
           le.commission_scheme_id,
           (v_open + sum(le.amount) over (order by le.created_at, le.id rows unbounded preceding))::numeric(12,2)
    from public.ledger_entries le
    where le.payee_type = p_payee_type
      and le.payee_id   = p_payee_id
      and (le.created_at at time zone 'UTC')::date between p_from and p_to
    order by le.created_at, le.id;

  select coalesce(sum(le.amount), 0)::numeric(12,2)
    into v_close
  from public.ledger_entries le
  where le.payee_type = p_payee_type
    and le.payee_id   = p_payee_id
    and (le.created_at at time zone 'UTC')::date <= p_to;

  return query
    select 'closing'::text, null::bigint, p_to, null::public.ledger_entry_type,
           (v_close - v_open)::numeric(12,2), null::char(3), 'Closing balance'::text,
           null::uuid, null::uuid, null::uuid, v_close;
end;
$$;

-- Semantic search (docs/11 §6.3). INVOKER, so the embeddings RLS — which mirrors
-- source-row visibility — is the whole enforcement story. Returns only the
-- pre-redacted content that was actually embedded, so a snippet is safe to
-- re-surface into the agent loop by construction.
--
-- The ANN scan is isolated in its own CTE so the HNSW index (an expression index
-- over halfvec(2048); see 004) can serve the ORDER BY ... LIMIT before any join.
-- Distances are computed with the schema-qualified operator form because the
-- function runs with an empty search_path.
create or replace function public.fn_semantic_search(
  p_embedding    extensions.vector,
  p_top_k        integer default 10,
  p_source_types public.embedding_source[] default null
)
returns table (
  source_type  public.embedding_source,
  subject_name text,
  snippet      text,
  similarity   numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cfg as (
    select (s.value #>> '{}') as embedding_model
    from public.app_settings s
    where s.key = 'ai.embedding.model'
  ),
  hits as (
    select e.source_type as st,
           e.source_id   as sid,
           e.model_id    as mid,
           e.operator_id as oid,
           e.content     as content,
           (e.embedding OPERATOR(extensions.<=>) p_embedding) as dist
    from public.embeddings e
    where (p_source_types is null or e.source_type = any (p_source_types))
      and (
        not exists (select 1 from cfg)
        or e.embedding_model = (select c.embedding_model from cfg c)
      )
    order by (e.embedding::extensions.halfvec(2048))
             OPERATOR(extensions.<=>)
             (p_embedding::extensions.halfvec(2048))
    limit greatest(least(coalesce(p_top_k, 10), 50), 1)
  )
  select h.st,
         coalesce(m.stage_name, o.display_name, pl.name, '(unknown)'),
         left(h.content, 500),
         round((1 - h.dist)::numeric, 6)
  from hits h
  left join public.models    m  on m.id  = h.mid
  left join public.operators o  on o.id  = h.oid
  left join public.platforms pl on h.st = 'platform' and pl.id = h.sid
  order by h.dist;
$$;

-- =============================================================================
-- 5. Write RPCs (docs/09 — NOT analytics objects)
-- -----------------------------------------------------------------------------
-- Restricted to super_admin and finance per the capability matrix in docs/03.
-- Both are SECURITY INVOKER, so RLS still governs every row they touch; the
-- explicit role check makes the failure mode a clear error instead of a policy
-- violation halfway through a batch.
-- =============================================================================

-- Idempotent per (earning_id, payee): a re-run posts only what is missing, which
-- is what makes the monthly close forgiving when a late earning row arrives
-- (docs/09 §5.3). Idempotency rests on the partial unique index created in 003,
-- so it is race-safe rather than read-then-write.
create or replace function public.fn_generate_earning_shares(
  p_period_start date,
  p_period_end   date
)
returns table (
  posted_count  integer,
  skipped_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_actor   uuid             := auth.uid();
  v_earning record;
  v_assign  record;
  v_scheme  public.commission_schemes%rowtype;
  v_amount  numeric(12,2);
  v_posted  integer := 0;
  v_skipped integer := 0;
  v_n       integer;
begin
  if v_role is null or v_role not in ('super_admin', 'finance') then
    raise exception 'fn_generate_earning_shares is restricted to super_admin and finance'
      using errcode = '42501';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid period: % .. %', p_period_start, p_period_end using errcode = '22023';
  end if;

  for v_earning in
    select e.id, e.model_id, e.platform_account_id, e.period_start, e.period_end,
           e.net_amount, e.currency
    from public.earnings e
    where e.period_start >= p_period_start
      and e.period_end   <= p_period_end
    order by e.period_end, e.id
  loop
    -- Scheme resolution: account-specific -> model-specific -> default, matching
    -- on the earning row's period_end. The exclusion constraint in 003
    -- guarantees at most one candidate per tier, so ORDER BY tier + LIMIT 1 is
    -- deterministic (docs/09 §4.1).
    select cs.*
      into v_scheme
    from public.commission_schemes cs
    where v_earning.period_end >= cs.effective_from
      and (cs.effective_to is null or v_earning.period_end <= cs.effective_to)
      and (
            cs.platform_account_id = v_earning.platform_account_id
         or (cs.platform_account_id is null and cs.model_id = v_earning.model_id)
         or (cs.platform_account_id is null and cs.model_id is null)
      )
    order by (case
                when cs.platform_account_id is not null then 0
                when cs.model_id is not null            then 1
                else 2
              end)
    limit 1;

    if not found then
      raise exception 'no commission scheme resolves for earning % (period_end %)',
        v_earning.id, v_earning.period_end using errcode = '23502';
    end if;

    -- Model share -----------------------------------------------------------
    v_amount := round(v_earning.net_amount * v_scheme.model_percent / 100.0, 2);
    if v_amount <> 0 then
      insert into public.ledger_entries (
        payee_type, payee_id, entry_type, amount, currency,
        period_start, period_end, earning_id, commission_scheme_id, description, created_by
      )
      values (
        'model', v_earning.model_id, 'earning_share', v_amount, v_earning.currency,
        v_earning.period_start, v_earning.period_end, v_earning.id, v_scheme.id,
        'Model share of earning ' || v_earning.id::text, v_actor
      )
      on conflict do nothing;

      get diagnostics v_n = row_count;
      if v_n = 1 then v_posted := v_posted + 1; else v_skipped := v_skipped + 1; end if;
    end if;

    -- Operator pool, weighted per assignment. Weights summing below 100 leave a
    -- remainder that falls to the studio — nothing is posted to a phantom payee
    -- (docs/09 §4.3).
    for v_assign in
      select oa.operator_id, oa.pool_share_percent
      from public.operator_assignments oa
      where oa.model_id = v_earning.model_id
        and v_earning.period_end >= oa.assigned_from
        and (oa.assigned_to is null or v_earning.period_end <= oa.assigned_to)
    loop
      v_amount := round(
        v_earning.net_amount
        * v_scheme.operator_percent / 100.0
        * v_assign.pool_share_percent / 100.0, 2);

      if v_amount <> 0 then
        insert into public.ledger_entries (
          payee_type, payee_id, entry_type, amount, currency,
          period_start, period_end, earning_id, commission_scheme_id, description, created_by
        )
        values (
          'operator', v_assign.operator_id, 'earning_share', v_amount, v_earning.currency,
          v_earning.period_start, v_earning.period_end, v_earning.id, v_scheme.id,
          'Operator share of earning ' || v_earning.id::text, v_actor
        )
        on conflict do nothing;

        get diagnostics v_n = row_count;
        if v_n = 1 then v_posted := v_posted + 1; else v_skipped := v_skipped + 1; end if;
      end if;
    end loop;
  end loop;

  return query select v_posted, v_skipped;
end;
$$;

-- Remembers today's projection so error can be measured later (docs/09 §8.2).
-- Three grains are written — (model, platform), (model, *) and (*, *) — because
-- v_forecast_accuracy compares at the platform-agnostic grain. The unique
-- expression index in 003 makes a second call on the same day a no-op.
create or replace function public.fn_snapshot_forecast(p_months_ahead integer default 3)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_months integer := greatest(coalesce(p_months_ahead, 3), 1);
  v_params jsonb;
  v_total  integer := 0;
  v_n      integer;
begin
  if v_role is null or v_role not in ('super_admin', 'finance') then
    raise exception 'fn_snapshot_forecast is restricted to super_admin and finance'
      using errcode = '42501';
  end if;

  v_params := jsonb_build_object('window', 3, 'growth_clamp', 0.25, 'months_ahead', v_months);

  insert into public.forecast_snapshots (generated_by, target_month, model_id, platform_id, predicted_net, method, params)
  select auth.uid(), f.target_month, f.model_id, f.platform_id, f.predicted_net, 'ma3_growth', v_params
  from public.fn_forecast(v_months) f
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.forecast_snapshots (generated_by, target_month, model_id, platform_id, predicted_net, method, params)
  select auth.uid(), f.target_month, f.model_id, null, sum(f.predicted_net)::numeric(12,2), 'ma3_growth', v_params
  from public.fn_forecast(v_months) f
  group by f.target_month, f.model_id
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.forecast_snapshots (generated_by, target_month, model_id, platform_id, predicted_net, method, params)
  select auth.uid(), f.target_month, null, null, sum(f.predicted_net)::numeric(12,2), 'ma3_growth', v_params
  from public.fn_forecast(v_months) f
  group by f.target_month
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;

-- =============================================================================
-- 6. Privileges
-- -----------------------------------------------------------------------------
-- Views are SELECT-only for clients; RLS on the base tables does the scoping.
-- anon reaches nothing, here or anywhere else.
-- =============================================================================
grant select on all tables in schema public to authenticated;
grant all    on all tables in schema public to service_role;
revoke all   on all tables in schema public from anon;

revoke all on function public.fn_forecast(integer)                              from public, anon;
revoke all on function public.fn_earnings_summary(date, date, text)             from public, anon;
revoke all on function public.fn_hours_summary(date, date)                      from public, anon;
revoke all on function public.fn_payout_summary(date, date)                     from public, anon;
revoke all on function public.fn_compliance_counts()                            from public, anon;
revoke all on function public.fn_payee_statement(public.payee_type, uuid, date, date) from public, anon;
revoke all on function public.fn_semantic_search(extensions.vector, integer, public.embedding_source[]) from public, anon;
revoke all on function public.fn_generate_earning_shares(date, date)            from public, anon;
revoke all on function public.fn_snapshot_forecast(integer)                     from public, anon;

grant execute on function public.fn_forecast(integer)                           to authenticated, service_role;
grant execute on function public.fn_earnings_summary(date, date, text)          to authenticated, service_role;
grant execute on function public.fn_hours_summary(date, date)                   to authenticated, service_role;
grant execute on function public.fn_payout_summary(date, date)                  to authenticated, service_role;
grant execute on function public.fn_compliance_counts()                         to authenticated, service_role;
grant execute on function public.fn_payee_statement(public.payee_type, uuid, date, date) to authenticated, service_role;
grant execute on function public.fn_semantic_search(extensions.vector, integer, public.embedding_source[]) to authenticated, service_role;
grant execute on function public.fn_generate_earning_shares(date, date)         to authenticated, service_role;
grant execute on function public.fn_snapshot_forecast(integer)                  to authenticated, service_role;

-- Supabase's default privileges hand anon EXECUTE on every function created by
-- postgres in `public` — including the SECURITY DEFINER trigger and audit
-- writers. Trigger functions cannot be invoked directly, but "no grant of any
-- kind for anon" should be literally true and checkable, so sweep the schema.
-- This is the last migration that creates functions; 010 and 011 create none.
revoke all on all functions in schema public from anon;
