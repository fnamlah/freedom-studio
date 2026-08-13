-- =============================================================================
-- 023 — Income tiers: the split changes with what the model earns
-- -----------------------------------------------------------------------------
-- Owner decision: a model's percentage is not fixed. The more she earns in a
-- WEEK, the better the split — and the team pool and studio share move with it.
--
-- Three decisions, taken deliberately and recorded here because each one is a
-- money rule someone will need to audit later:
--
--   1. BASIS — the model's TOTAL NET for the ISO week containing the earning's
--      `period_end`. Not the single earning line: a model with four platform
--      payouts in a week should reach the same tier as one with a single big
--      one.
--   2. STYLE — flat, not progressive. Reaching a tier prices the WHOLE week at
--      that tier's rates. (Consequence, stated plainly: there is a cliff at each
--      threshold — one dollar more of net can be worth a lot. That is what was
--      asked for and what studios normally mean.)
--   3. SHAPE — every tier states all three percentages and they must total 100,
--      so a rise in the model's share can be taken from the studio's without
--      touching the team pool.
--
-- Backwards compatible: a scheme with NO tiers behaves exactly as before, using
-- its own model/operator/studio percentages. Nothing already posted changes.
--
-- ⚠ OPERATIONAL RULE. Ledger entries are unique per (earning, payee) and the
-- close is `on conflict do nothing`, so an earning already posted is never
-- re-priced. If a week is closed and MORE earnings for that week are entered
-- afterwards, the earlier rows keep the tier they were posted at while the new
-- ones price at the higher tier. Close a week once its earnings are all in.
-- =============================================================================

set search_path = public, extensions;

create table if not exists public.commission_tiers (
  id               uuid primary key default gen_random_uuid(),
  scheme_id        uuid not null references public.commission_schemes (id) on delete cascade,
  -- Inclusive lower bound on the model's weekly net. The tier with the highest
  -- min_amount that the week reaches is the one that prices it.
  min_amount       numeric(12,2) not null check (min_amount >= 0),
  model_percent    numeric(5,2)  not null check (model_percent    between 0 and 100),
  operator_percent numeric(5,2)  not null check (operator_percent between 0 and 100),
  studio_percent   numeric(5,2)  not null check (studio_percent   between 0 and 100),
  created_at       timestamptz   not null default now(),
  created_by       uuid references public.profiles (id),

  constraint commission_tiers_sum_chk
    check (model_percent + operator_percent + studio_percent = 100),
  constraint commission_tiers_unique unique (scheme_id, min_amount)
);

create index if not exists commission_tiers_scheme_idx
  on public.commission_tiers (scheme_id, min_amount desc);

comment on table public.commission_tiers is
  'Income tiers for a commission scheme. The model''s total NET for the ISO week containing an earning''s period_end selects the tier; the whole week prices at that tier''s rates. A scheme with no tiers uses its own base percentages (023).';
comment on column public.commission_tiers.min_amount is
  'Inclusive lower bound on the model''s WEEKLY net. Highest matching tier wins.';
comment on column public.commission_tiers.operator_percent is
  'The TEAM pool at this tier — split among operators, coaches and team leaders by assignment weight (022).';

-- RLS mirrors commission_schemes exactly: super_admin writes, manager and
-- finance read. A tier is a money rule, so it is not manager-editable.
alter table public.commission_tiers enable row level security;

drop policy if exists aal2_active_required on public.commission_tiers;
create policy aal2_active_required on public.commission_tiers
  as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' and public.is_active_profile());

drop policy if exists commission_tiers_sa_all on public.commission_tiers;
create policy commission_tiers_sa_all on public.commission_tiers
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists commission_tiers_read on public.commission_tiers;
create policy commission_tiers_read on public.commission_tiers
  for select to authenticated
  using (public.current_user_role() in ('manager', 'finance'));

revoke all on public.commission_tiers from anon;
grant select, insert, update, delete on public.commission_tiers to authenticated;

-- -----------------------------------------------------------------------------
-- The close function, with tier resolution added.
-- -----------------------------------------------------------------------------
-- Everything below is unchanged from 009 except the two marked blocks: the
-- weekly total + tier lookup, and using the resolved percentages instead of the
-- scheme's own. The scheme-resolution, the pool weighting, the idempotent
-- `on conflict do nothing` and the role gate are all exactly as they were.
-- -----------------------------------------------------------------------------
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
  v_role       public.user_role := public.current_user_role();
  v_actor      uuid             := auth.uid();
  v_earning    record;
  v_assign     record;
  v_scheme     public.commission_schemes%rowtype;
  v_tier       public.commission_tiers%rowtype;
  v_model_pct  numeric(5,2);
  v_team_pct   numeric(5,2);
  v_week_net   numeric(12,2);
  v_amount     numeric(12,2);
  v_posted     integer := 0;
  v_skipped    integer := 0;
  v_n          integer;
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

    -- === TIER RESOLUTION (023) ==============================================
    -- The model's total net for the ISO week this earning's period_end falls
    -- in. Counts every earning in that week, not only those inside the range
    -- being closed, so closing one day at a time cannot understate the week.
    select coalesce(sum(e2.net_amount), 0)
      into v_week_net
    from public.earnings e2
    where e2.model_id = v_earning.model_id
      and date_trunc('week', e2.period_end) = date_trunc('week', v_earning.period_end);

    select ct.*
      into v_tier
    from public.commission_tiers ct
    where ct.scheme_id = v_scheme.id
      and ct.min_amount <= v_week_net
    order by ct.min_amount desc
    limit 1;

    if found then
      v_model_pct := v_tier.model_percent;
      v_team_pct  := v_tier.operator_percent;
    else
      -- No tiers defined, or the week is below the lowest threshold: the
      -- scheme's own percentages apply, exactly as before 023.
      v_model_pct := v_scheme.model_percent;
      v_team_pct  := v_scheme.operator_percent;
    end if;
    -- ========================================================================

    -- Model share -----------------------------------------------------------
    v_amount := round(v_earning.net_amount * v_model_pct / 100.0, 2);
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

    -- Team pool (operators, coaches, team leaders — 022), weighted per
    -- assignment. Weights summing below 100 leave a remainder that falls to the
    -- studio — nothing is posted to a phantom payee (docs/09 §4.3).
    for v_assign in
      select oa.operator_id, oa.pool_share_percent
      from public.operator_assignments oa
      where oa.model_id = v_earning.model_id
        and v_earning.period_end >= oa.assigned_from
        and (oa.assigned_to is null or v_earning.period_end <= oa.assigned_to)
    loop
      v_amount := round(
        v_earning.net_amount
        * v_team_pct / 100.0
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
  end loop;

  return query select v_posted, v_skipped;
end;
$$;
