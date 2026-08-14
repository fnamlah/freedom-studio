-- =============================================================================
-- 031 — The rest of the studio, writable from Telegram
-- -----------------------------------------------------------------------------
-- 029/030 gave the agent the day-to-day records: earnings, sessions, expenses,
-- models, document details. What it could not touch was most of what SETTING UP
-- a studio actually is — operators, coaches, team leaders, platforms, accounts,
-- who works with whom, and the commission rules. The owner asked for both
-- surfaces to be equal: "details of all jobs, names, birthdates, percentages …
-- 1. through telegram bot 2. or through the system / web app".
--
-- Every wrapper follows 029's shape exactly and inherits its caveat verbatim:
-- these are SECURITY DEFINER functions owned by the table owner and no table
-- here sets FORCE ROW LEVEL SECURITY, so **RLS is not evaluated inside them**.
-- The gate is the explicit approver-role check plus the approval that had to
-- happen first. Two exceptions, and they are the interesting ones:
--
--   * `fn_agent_set_rate_card` delegates to `fn_set_commission_rates` (025),
--     which is SECURITY INVOKER and re-checks `current_user_role()` itself. The
--     impersonation is what makes that check pass — and its solvency proof
--     ("the studio can never owe more than 100% of a dollar") therefore still
--     runs, unmodified, on this path.
--   * `fn_agent_approve_payout` relies on `enforce_payout_transition` (007),
--     which reads `current_user_role()` too. So the trigger's "only super_admin
--     may approve" is REAL enforcement here, not decoration.
--
-- THREE CROSS-ROW RULES the wrappers surface as sentences instead of SQLSTATEs,
-- because an approver reading a Telegram card cannot look up an error code:
--   * `operator_assignments` no-overlap GiST + the 100%-pool trigger (007).
--   * `commission_schemes` no-overlap-per-scope GiST (003).
--   * "exactly one default scheme" — which exists ONLY as an `if` in
--     `schemes/actions.ts`, with no DB trigger behind it. A wrapper that
--     re-scoped or replaced a default would sail straight past it, so
--     `fn_agent_upsert_scheme` re-checks it here.
--
-- ARCHIVE, NOT DELETE. Nothing below deletes an entity. The portal has no
-- delete action for models, operators or platforms either — retirement is a
-- status flip — and the database agrees: `operator_assignments.operator_id` and
-- `documents.model_id` are ON DELETE RESTRICT, so anyone with history cannot be
-- removed anyway. `fn_agent_delete_record` keeps its original three kinds and
-- gains nothing here.
-- =============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- operators ---
-- Covers coaches and team leaders too, via `staff_role` (022). All three are
-- paid identically — they share the scheme's team pool — so one wrapper is
-- correct rather than convenient.
create or replace function public.fn_agent_upsert_operator(
  p_approver     uuid,
  p_operator_id  uuid default null,
  p_display_name text default null,
  p_legal_name   text default null,
  p_staff_role   public.staff_role default null,
  p_email        text default null,
  p_phone        text default null,
  p_country      char(2) default null,
  p_start_date   date default null,
  p_notes        text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_operator_id is null then
    if p_display_name is null or p_legal_name is null then
      raise exception 'a new team member needs a display name and a legal name'
        using errcode = '23502';
    end if;
    insert into public.operators (
      display_name, legal_name, staff_role, email, phone, country,
      start_date, notes, created_by
    )
    values (
      p_display_name, p_legal_name, coalesce(p_staff_role, 'operator'),
      p_email, p_phone, p_country, p_start_date, p_notes, p_approver
    )
    returning id into v_id;
  else
    -- Only supplied fields change; omission never blanks a column.
    update public.operators o
       set display_name = coalesce(p_display_name, o.display_name),
           legal_name   = coalesce(p_legal_name, o.legal_name),
           staff_role   = coalesce(p_staff_role, o.staff_role),
           email        = coalesce(p_email, o.email),
           phone        = coalesce(p_phone, o.phone),
           country      = coalesce(p_country, o.country),
           start_date   = coalesce(p_start_date, o.start_date),
           notes        = coalesce(p_notes, o.notes)
     where o.id = p_operator_id
    returning o.id into v_id;

    if v_id is null then
      raise exception 'team member % not found', p_operator_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- platforms ---
create or replace function public.fn_agent_upsert_platform(
  p_approver    uuid,
  p_platform_id uuid default null,
  p_name        text default null,
  p_website_url text default null,
  p_is_active   boolean default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_platform_id is null then
    if p_name is null then
      raise exception 'a new platform needs a name' using errcode = '23502';
    end if;
    -- `platforms.name` is UNIQUE. Saying so plainly beats a 23505 on a card.
    if exists (select 1 from public.platforms p where lower(p.name) = lower(p_name)) then
      raise exception 'a platform called "%" already exists', p_name using errcode = '23505';
    end if;
    insert into public.platforms (name, website_url, is_active)
    values (p_name, p_website_url, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.platforms p
       set name        = coalesce(p_name, p.name),
           website_url = coalesce(p_website_url, p.website_url),
           is_active   = coalesce(p_is_active, p.is_active)
     where p.id = p_platform_id
    returning p.id into v_id;

    if v_id is null then
      raise exception 'platform % not found', p_platform_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------- accounts ---
-- An account's IDENTITY — which model, on which platform — is fixed at
-- creation, matching the manual form, whose update path carries only username
-- and fee. That is not a UI simplification: moving an existing account to
-- another model would silently re-attribute every earning already recorded
-- against it, and `earnings.model_id` is copied from the account at insert.
create or replace function public.fn_agent_upsert_account(
  p_approver    uuid,
  p_account_id  uuid default null,
  p_model_id    uuid default null,
  p_platform_id uuid default null,
  p_username    text default null,
  p_fee_percent numeric default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_account_id is null then
    if p_model_id is null or p_platform_id is null or p_username is null then
      raise exception 'a new account needs a model, a platform and a username'
        using errcode = '23502';
    end if;
    if exists (
      select 1 from public.platform_accounts a
      where a.model_id = p_model_id and a.platform_id = p_platform_id
        and lower(a.username) = lower(p_username)
    ) then
      raise exception 'that model already has an account "%" on that platform', p_username
        using errcode = '23505';
    end if;
    insert into public.platform_accounts (model_id, platform_id, username, platform_fee_percent)
    values (p_model_id, p_platform_id, p_username, p_fee_percent)
    returning id into v_id;
  else
    update public.platform_accounts a
       set username             = coalesce(p_username, a.username),
           platform_fee_percent = coalesce(p_fee_percent, a.platform_fee_percent)
     where a.id = p_account_id
    returning a.id into v_id;

    if v_id is null then
      raise exception 'account % not found', p_account_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

-- -------------------------------------------------------------- assignments ---
-- Attaches an operator / coach / team leader to a model for a date range, with
-- their weight in that model's team pool.
create or replace function public.fn_agent_upsert_assignment(
  p_approver      uuid,
  p_assignment_id uuid default null,
  p_operator_id   uuid default null,
  p_model_id      uuid default null,
  p_pool_share    numeric default null,
  p_from          date default null,
  p_to            date default null,
  p_clear_end     boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  begin
    if p_assignment_id is null then
      if p_operator_id is null or p_model_id is null or p_from is null then
        raise exception 'a new assignment needs a team member, a model and a start date'
          using errcode = '23502';
      end if;
      insert into public.operator_assignments (
        operator_id, model_id, pool_share_percent, assigned_from, assigned_to, created_by
      )
      values (
        p_operator_id, p_model_id, coalesce(p_pool_share, 100), p_from, p_to, p_approver
      )
      returning id into v_id;
    else
      -- `p_clear_end` distinguishes "leave the end date alone" (the coalesce
      -- default everywhere else) from "this assignment is open-ended again".
      -- Without it there would be no way to reopen one, since null means
      -- "unchanged" on every other parameter here.
      update public.operator_assignments a
         set pool_share_percent = coalesce(p_pool_share, a.pool_share_percent),
             assigned_from      = coalesce(p_from, a.assigned_from),
             assigned_to        = case when p_clear_end then null
                                       else coalesce(p_to, a.assigned_to) end
       where a.id = p_assignment_id
      returning a.id into v_id;

      if v_id is null then
        raise exception 'assignment % not found', p_assignment_id using errcode = 'P0002';
      end if;
    end if;
  exception
    -- The GiST exclusion and the pool trigger both fire here. Neither message
    -- means anything to someone reading a phone, so translate once, at the
    -- boundary, rather than in three callers.
    when exclusion_violation then
      raise exception
        'that person already has an overlapping assignment to this model — end the existing one first'
        using errcode = '23P01';
    when check_violation then
      raise exception
        'that would push this model''s team pool over 100%% on at least one date'
        using errcode = '23514';
  end;

  return v_id;
end;
$$;

-- -------------------------------------------------------------- archiving ----
-- The retire path. Whitelisted kinds only, and each maps to the column the
-- portal's own retire action writes, so a record archived from Telegram is
-- indistinguishable from one archived in the web app.
create or replace function public.fn_agent_set_status(
  p_approver uuid,
  p_kind     text,
  p_id       uuid,
  p_status   text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role    public.user_role;
  v_touched integer := 0;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_kind = 'model' then
    update public.models set status = p_status::public.model_status where id = p_id;
  elsif p_kind = 'operator' then
    update public.operators set status = p_status::public.model_status where id = p_id;
  elsif p_kind = 'account' then
    update public.platform_accounts set status = p_status::public.account_status where id = p_id;
  elsif p_kind = 'platform' then
    -- Platforms have no status enum; `is_active` is their retirement switch.
    update public.platforms
       set is_active = (p_status in ('active', 'true'))
     where id = p_id;
  else
    raise exception 'agent may not change the status of "%"', p_kind using errcode = '42501';
  end if;

  get diagnostics v_touched = row_count;
  return v_touched > 0;
end;
$$;

-- ------------------------------------------------------------------ schemes ---
-- SUPER ADMIN ONLY, and deliberately so: commission schemes are SA-only in 008,
-- docs/09 §4.2 and docs/08. A manager can record what was earned; only the
-- owner decides how it is divided.
create or replace function public.fn_agent_upsert_scheme(
  p_approver     uuid,
  p_scheme_id    uuid default null,
  p_model_id     uuid default null,
  p_account_id   uuid default null,
  p_model_pct    numeric default null,
  p_operator_pct numeric default null,
  p_studio_pct   numeric default null,
  p_from         date default null,
  p_to           date default null,
  p_notes        text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_model_id is not null and p_account_id is not null then
    raise exception 'a scheme applies to a model or to one account, never both'
      using errcode = '23514';
  end if;

  begin
    if p_scheme_id is null then
      if p_model_pct is null or p_operator_pct is null or p_studio_pct is null or p_from is null then
        raise exception 'a new scheme needs all three percentages and a start date'
          using errcode = '23502';
      end if;
      -- The single-default rule lives only in `schemes/actions.ts` — there is
      -- no trigger behind it — so a wrapper that skipped this check would be
      -- the one way to end up with two defaults and a silently ambiguous
      -- resolution order.
      if p_model_id is null and p_account_id is null
         and exists (
           select 1 from public.commission_schemes cs
           where cs.model_id is null and cs.platform_account_id is null
         )
      then
        raise exception 'there is already a studio-wide default scheme — edit that one instead'
          using errcode = '23505';
      end if;

      insert into public.commission_schemes (
        model_id, platform_account_id, model_percent, operator_percent,
        studio_percent, effective_from, effective_to, notes, created_by
      )
      values (
        p_model_id, p_account_id, p_model_pct, p_operator_pct,
        p_studio_pct, p_from, p_to, p_notes, p_approver
      )
      returning id into v_id;
    else
      -- Scope is a scheme's identity; a different scope is a different scheme.
      -- Only the split, the window and the notes may change, matching the
      -- portal's update path exactly.
      update public.commission_schemes cs
         set model_percent    = coalesce(p_model_pct, cs.model_percent),
             operator_percent = coalesce(p_operator_pct, cs.operator_percent),
             studio_percent   = coalesce(p_studio_pct, cs.studio_percent),
             effective_from   = coalesce(p_from, cs.effective_from),
             effective_to     = coalesce(p_to, cs.effective_to),
             notes            = coalesce(p_notes, cs.notes)
       where cs.id = p_scheme_id
      returning cs.id into v_id;

      if v_id is null then
        raise exception 'scheme % not found', p_scheme_id using errcode = 'P0002';
      end if;
    end if;
  exception
    when exclusion_violation then
      raise exception
        'another scheme already covers part of that date range for the same scope'
        using errcode = '23P01';
  end;

  return v_id;
end;
$$;

-- Replaces a scheme's rate card. Delegates to 025 rather than reimplementing
-- it, so the atomic replace and the solvency proof both still run — and 025's
-- own super_admin check re-fires under the impersonated claims, which is a
-- second, independent gate on this path.
create or replace function public.fn_agent_set_rate_card(
  p_approver  uuid,
  p_scheme_id uuid,
  p_rates     jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);
  return public.fn_set_commission_rates(p_scheme_id, p_rates);
end;
$$;

-- ------------------------------------------------------------------ payouts ---
-- ⚠ THIS RELAXES A DOCUMENTED CONTROL, by explicit owner decision, and is
-- written down rather than slipped in.
--
-- docs/03 §110 states the split exists so that "one insider could not
-- ORIGINATE an obligation, AUTHORIZE its payment, and EXECUTE the release";
-- `hermes/src/governance/policy.ts` says "Hermes can never be both halves".
-- Until now `approve_payout` was `human_only` — proposable, never executable by
-- the agent — so approval happened in the portal.
--
-- The owner asked for approval from Telegram, with no self-approval
-- restriction. What that gives up: a super_admin who created a payout can now
-- also approve it from their phone, without a second person and without
-- opening the portal. What it keeps:
--   * `enforce_payout_transition` (007) still runs, and because the claims are
--     the approver's, its "only super_admin may approve" check is live.
--   * Only pending → approved. Settlement (`mark_payout_paid`) is untouched and
--     stays `human_only`, so releasing money is still a separate, portal-side
--     act by a different role.
--   * `approved_by` records the human, never the agent, so the audit trail
--     names who authorised it.
create or replace function public.fn_agent_approve_payout(
  p_approver uuid,
  p_payout_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role   public.user_role;
  v_status public.payout_status;
  v_id     uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  select p.status into v_status from public.payouts p where p.id = p_payout_id;
  if v_status is null then
    raise exception 'payout % not found', p_payout_id using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'that payout is already %, so there is nothing to approve', v_status
      using errcode = '23514';
  end if;

  update public.payouts p
     set status = 'approved', approved_by = p_approver
   where p.id = p_payout_id
  returning p.id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------------- grants ---
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agent_upsert_operator(uuid, uuid, text, text, public.staff_role, text, text, char, date, text)',
    'public.fn_agent_upsert_platform(uuid, uuid, text, text, boolean)',
    'public.fn_agent_upsert_account(uuid, uuid, uuid, uuid, text, numeric)',
    'public.fn_agent_upsert_assignment(uuid, uuid, uuid, uuid, numeric, date, date, boolean)',
    'public.fn_agent_set_status(uuid, text, uuid, text)',
    'public.fn_agent_upsert_scheme(uuid, uuid, uuid, uuid, numeric, numeric, numeric, date, date, text)',
    'public.fn_agent_set_rate_card(uuid, uuid, jsonb)',
    'public.fn_agent_approve_payout(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on function public.fn_agent_upsert_scheme(uuid, uuid, uuid, uuid, numeric, numeric, numeric, date, date, text) is
  'Creates or edits a commission scheme on behalf of an approving super_admin (031). Re-checks the single-default rule, which has no DB trigger behind it, and translates the no-overlap exclusion into prose.';

comment on function public.fn_agent_approve_payout(uuid, uuid) is
  'Moves a payout pending -> approved on behalf of an approving super_admin (031). Relaxes the docs/03 §110 origination/authorization split by owner decision; settlement stays human-only and enforce_payout_transition still runs under the approver''s claims.';
