-- =============================================================================
-- 025 — The studio's rate card: per-role percentages of the weekly net
-- -----------------------------------------------------------------------------
-- The owner supplied the studio's actual commission structure (2026-08-13),
-- and it does not fit the pool model: each ROLE has its own percentage of the
-- model's weekly net with its OWN brackets — the model's rates break at
-- 1500/2500 while the operator's and team leader's break at 1500/3000 — and
-- the model's own table depends on WHO IS AROUND HER:
--
--   independent model                       80%
--   model with a coach only          60 / 65 / 70
--   model with an operator           45 / 50 / 55   (coach may also be present)
--   operator                         25 / 28 / 30
--   coach                                       7%
--   team leader                        2 /  3 /  4
--
-- A single "team pool split by fixed weights" (009/022/023) cannot express
-- per-role brackets exactly: the operator's share of a combined pool would
-- drift as different roles cross different thresholds. So the card stores one
-- row per (party, threshold), and the close pays each person their OWN rate.
--
-- Decisions, recorded because every one is a money rule someone will audit:
--
--   1. WEEK — Sunday through Saturday, per the owner ("Sunday - Saturday").
--      NOT the ISO week 023 used. Implemented as
--      date_trunc('week', day + 1 day) - 1 day, which maps every date to the
--      Sunday that starts its week.
--   2. BASIS — the model's TOTAL net for that week, all statements summed.
--   3. STYLE — flat, not progressive: the whole week pays at the reached rate
--      (owner's earlier decision, unchanged).
--   4. BRACKETS — "up to 1500" / "1501–…" exactly as written: a week of
--      1500.99 is still the low bracket (thresholds are 1501, 2500, 3000;
--      "2500+" and "3000+" are inclusive).
--   5. COMPOSITION — an operator's presence selects the with-operator table
--      even when a coach is also assigned (more support staff = the lower
--      model rate; the coach still earns her 7%). A coach alone selects the
--      with-coach table. Anyone else (including a team leader alone) leaves
--      the model independent; the team leader still earns their own cut.
--   6. STUDIO — the remainder. Never posted (the studio has no payee row),
--      and the set-function proves every composition sums ≤ 100 at every
--      threshold, so the remainder can never go negative.
--   7. SAME ROLE TWICE — two operators on one model split the OPERATOR rate
--      by their assignment weights, normalized within the role.
--
-- Supersedes 023/024: `commission_tiers` shipped hours earlier, holds no data
-- in any environment, and modelled the split three-way — keeping both would
-- leave two competing tier mechanisms in one close function. Dropped here.
-- Schemes WITHOUT a rate card keep the original pool behavior (009), which
-- remains the fallback for scoped overrides.
-- =============================================================================

set search_path = public, extensions;

-- ------------------------------------------------------------------ cleanup --
drop function if exists public.fn_set_commission_tiers(uuid, jsonb);
drop table if exists public.commission_tiers;

-- -------------------------------------------------------------------- table --
do $$
begin
  if not exists (select 1 from pg_type where typname = 'commission_party') then
    create type public.commission_party as enum (
      'model_independent',   -- no operator, no coach
      'model_with_coach',    -- coach but no operator
      'model_with_operator', -- operator present (coach may also be)
      'operator',
      'coach',
      'team_leader'
    );
  end if;
end $$;

create table if not exists public.commission_rates (
  id         uuid primary key default gen_random_uuid(),
  scheme_id  uuid not null references public.commission_schemes (id) on delete cascade,
  party      public.commission_party not null,
  -- Inclusive lower bound on the model's weekly (Sun–Sat) net. The row with
  -- the highest min_amount the week reaches is the one that pays.
  min_amount numeric(12,2) not null check (min_amount >= 0),
  percent    numeric(5,2)  not null check (percent >= 0 and percent <= 100),
  created_at timestamptz   not null default now(),
  created_by uuid references public.profiles (id),

  constraint commission_rates_unique unique (scheme_id, party, min_amount)
);

create index if not exists commission_rates_scheme_idx
  on public.commission_rates (scheme_id, party, min_amount desc);

comment on table public.commission_rates is
  'The studio rate card: each party''s percentage of the model''s weekly (Sunday–Saturday) net, per income bracket. The model''s party is chosen by team composition; the studio keeps the remainder. A scheme with no rows falls back to the 009 pool behavior (025).';
comment on column public.commission_rates.min_amount is
  'Inclusive lower bound on the model''s weekly net. Highest matching row per party wins.';

-- RLS mirrors commission_schemes: super_admin writes, manager/finance read.
alter table public.commission_rates enable row level security;

drop policy if exists aal2_active_required on public.commission_rates;
create policy aal2_active_required on public.commission_rates
  as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' and public.is_active_profile());

drop policy if exists commission_rates_sa_all on public.commission_rates;
create policy commission_rates_sa_all on public.commission_rates
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists commission_rates_read on public.commission_rates;
create policy commission_rates_read on public.commission_rates
  for select to authenticated
  using (public.current_user_role() in ('manager', 'finance'));

revoke all on public.commission_rates from anon;
grant select, insert, update, delete on public.commission_rates to authenticated;

-- The rate a party earns at weekly net m under a scheme's card, or NULL when
-- the card has no rows for that party. STABLE: pure lookup, used by both the
-- set-function's solvency proof and the close.
create or replace function public.fn_rate_at(
  p_scheme_id uuid,
  p_party     public.commission_party,
  p_week_net  numeric
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select cr.percent
  from public.commission_rates cr
  where cr.scheme_id = p_scheme_id
    and cr.party = p_party
    and cr.min_amount <= p_week_net
  order by cr.min_amount desc
  limit 1;
$$;

revoke all on function public.fn_rate_at(uuid, public.commission_party, numeric) from public, anon;
grant execute on function public.fn_rate_at(uuid, public.commission_party, numeric) to authenticated;

-- ----------------------------------------------------------------- set card --
-- Replaces a scheme's whole card in ONE transaction (the 024 argument: a
-- DELETE + INSERT over two requests could strand a scheme half-carded), and
-- proves the card can never pay out more than 100% of a week: for every
-- composition, at every threshold, the sum of every party that composition
-- can include must stay ≤ 100.
create or replace function public.fn_set_commission_rates(
  p_scheme_id uuid,
  p_rates     jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_actor  uuid             := auth.uid();
  v_count  integer;
  v_m      numeric;
  v_bad    numeric;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'fn_set_commission_rates is restricted to super_admin'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_rates) <> 'array' then
    raise exception 'p_rates must be a json array' using errcode = '22023';
  end if;

  if not exists (select 1 from public.commission_schemes cs where cs.id = p_scheme_id) then
    raise exception 'commission scheme % not found', p_scheme_id using errcode = '23503';
  end if;

  delete from public.commission_rates cr where cr.scheme_id = p_scheme_id;

  insert into public.commission_rates (scheme_id, party, min_amount, percent, created_by)
  select
    p_scheme_id,
    (r->>'party')::public.commission_party,
    (r->>'min_amount')::numeric,
    (r->>'percent')::numeric,
    v_actor
  from jsonb_array_elements(p_rates) as r;

  get diagnostics v_count = row_count;

  -- Solvency proof. rate(party, m) = the row that would pay at weekly net m;
  -- absent parties contribute 0 here (the close is stricter: a PRESENT party
  -- with no rows fails the close loudly rather than earning silently nothing).
  for v_m in
    select distinct cr.min_amount from public.commission_rates cr
    where cr.scheme_id = p_scheme_id
  loop
    select greatest(
      coalesce(public.fn_rate_at(p_scheme_id, 'model_with_operator', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'operator', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'coach', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'team_leader', v_m), 0),
      coalesce(public.fn_rate_at(p_scheme_id, 'model_with_coach', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'coach', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'team_leader', v_m), 0),
      coalesce(public.fn_rate_at(p_scheme_id, 'model_independent', v_m), 0)
        + coalesce(public.fn_rate_at(p_scheme_id, 'team_leader', v_m), 0)
    ) into v_bad;

    if v_bad > 100 then
      raise exception 'rate card pays out %.2f%% of a %.2f week — over 100%%', v_bad, v_m
        using errcode = '23514';
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.fn_set_commission_rates(uuid, jsonb) is
  'Replaces a scheme''s entire rate card in one transaction and proves no composition can pay out more than 100% at any threshold. Empty array clears it, returning the scheme to the 009 pool behavior (025).';

revoke all on function public.fn_set_commission_rates(uuid, jsonb) from public, anon;
grant execute on function public.fn_set_commission_rates(uuid, jsonb) to authenticated;

-- -------------------------------------------------------------- close, v3 ---
-- Scheme resolution (account > model > default), the idempotent
-- `on conflict do nothing`, and the role gate are unchanged from 009. What is
-- new: a scheme WITH card rows pays every party their own rate of the weekly
-- (Sunday–Saturday) net; a scheme without stays on the original pool math.
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
  v_role         public.user_role := public.current_user_role();
  v_actor        uuid             := auth.uid();
  v_earning      record;
  v_assign       record;
  v_scheme       public.commission_schemes%rowtype;
  v_has_card     boolean;
  v_week_net     numeric(12,2);
  v_has_operator boolean;
  v_has_coach    boolean;
  v_model_party  public.commission_party;
  v_rate         numeric;
  v_role_total   numeric;
  v_amount       numeric(12,2);
  v_posted       integer := 0;
  v_skipped      integer := 0;
  v_n            integer;
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

    v_has_card := exists (
      select 1 from public.commission_rates cr where cr.scheme_id = v_scheme.id
    );

    if v_has_card then
      -- === RATE CARD (025) =================================================
      -- The model's total net for the SUNDAY–SATURDAY week containing this
      -- earning's period_end. date_trunc('week', d) is ISO (Monday); shifting
      -- the input by one day makes Sunday the boundary.
      select coalesce(sum(e2.net_amount), 0)
        into v_week_net
      from public.earnings e2
      where e2.model_id = v_earning.model_id
        and date_trunc('week', e2.period_end + interval '1 day')
          = date_trunc('week', v_earning.period_end + interval '1 day');

      -- Composition for THIS earning's date, from the assignments in force.
      select
        bool_or(o.staff_role = 'operator'),
        bool_or(o.staff_role = 'coach')
        into v_has_operator, v_has_coach
      from public.operator_assignments oa
      join public.operators o on o.id = oa.operator_id
      where oa.model_id = v_earning.model_id
        and v_earning.period_end >= oa.assigned_from
        and (oa.assigned_to is null or v_earning.period_end <= oa.assigned_to);

      v_model_party := case
        when coalesce(v_has_operator, false) then 'model_with_operator'
        when coalesce(v_has_coach, false)    then 'model_with_coach'
        else 'model_independent'
      end::public.commission_party;

      -- Model share ---------------------------------------------------------
      v_rate := public.fn_rate_at(v_scheme.id, v_model_party, v_week_net);
      if v_rate is null then
        raise exception 'rate card for scheme % has no % rows (weekly net %)',
          v_scheme.id, v_model_party, v_week_net using errcode = '23502';
      end if;

      v_amount := round(v_earning.net_amount * v_rate / 100.0, 2);
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

      -- Team members: each their OWN rate; same-role colleagues split that
      -- role's rate by assignment weight, normalized within the role.
      for v_assign in
        select oa.operator_id, oa.pool_share_percent, o.staff_role,
               sum(oa.pool_share_percent)
                 over (partition by o.staff_role) as role_weight_total,
               count(*)
                 over (partition by o.staff_role) as role_member_count
        from public.operator_assignments oa
        join public.operators o on o.id = oa.operator_id
        where oa.model_id = v_earning.model_id
          and v_earning.period_end >= oa.assigned_from
          and (oa.assigned_to is null or v_earning.period_end <= oa.assigned_to)
      loop
        v_rate := public.fn_rate_at(
          v_scheme.id, v_assign.staff_role::text::public.commission_party, v_week_net);
        if v_rate is null then
          raise exception 'rate card for scheme % has no % rows (weekly net %)',
            v_scheme.id, v_assign.staff_role, v_week_net using errcode = '23502';
        end if;

        -- Zero-weight edge: when every member of a role has weight 0, split
        -- that role's rate evenly rather than dividing by zero; a lone member
        -- then simply gets the whole role rate.
        v_role_total := nullif(v_assign.role_weight_total, 0);
        v_amount := round(
          v_earning.net_amount * v_rate / 100.0
          * (case
              when v_role_total is null then 1.0 / v_assign.role_member_count
              else v_assign.pool_share_percent / v_role_total
            end), 2);

        if v_amount <> 0 then
          insert into public.ledger_entries (
            payee_type, payee_id, entry_type, amount, currency,
            period_start, period_end, earning_id, commission_scheme_id, description, created_by
          )
          values (
            'operator', v_assign.operator_id, 'earning_share', v_amount, v_earning.currency,
            v_earning.period_start, v_earning.period_end, v_earning.id, v_scheme.id,
            'Team share of earning ' || v_earning.id::text, v_actor
          )
          on conflict do nothing;
          get diagnostics v_n = row_count;
          if v_n = 1 then v_posted := v_posted + 1; else v_skipped := v_skipped + 1; end if;
        end if;
      end loop;

    else
      -- === POOL FALLBACK (009) — schemes without a card ====================
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
            'Team share of earning ' || v_earning.id::text, v_actor
          )
          on conflict do nothing;
          get diagnostics v_n = row_count;
          if v_n = 1 then v_posted := v_posted + 1; else v_skipped := v_skipped + 1; end if;
        end if;
      end loop;
    end if;
  end loop;

  return query select v_posted, v_skipped;
end;
$$;

-- --------------------------------------------------------------------- seed --
-- The studio's card, exactly as the owner stated it (2026-08-13), on the
-- default scheme so it applies studio-wide. Idempotent: only seeds when the
-- default scheme has no card yet.
do $$
declare
  v_default uuid;
begin
  select id into v_default
  from public.commission_schemes
  where model_id is null and platform_account_id is null
  limit 1;

  if v_default is null then
    return; -- no default scheme (fresh install order); nothing to seed onto
  end if;
  if exists (select 1 from public.commission_rates where scheme_id = v_default) then
    return;
  end if;

  insert into public.commission_rates (scheme_id, party, min_amount, percent) values
    (v_default, 'model_independent',      0, 80),
    (v_default, 'model_with_coach',       0, 60),
    (v_default, 'model_with_coach',    1501, 65),
    (v_default, 'model_with_coach',    2500, 70),
    (v_default, 'model_with_operator',    0, 45),
    (v_default, 'model_with_operator', 1501, 50),
    (v_default, 'model_with_operator', 2500, 55),
    (v_default, 'operator',               0, 25),
    (v_default, 'operator',            1501, 28),
    (v_default, 'operator',            3000, 30),
    (v_default, 'coach',                  0,  7),
    (v_default, 'team_leader',            0,  2),
    (v_default, 'team_leader',         1501,  3),
    (v_default, 'team_leader',         3000,  4);
end $$;
