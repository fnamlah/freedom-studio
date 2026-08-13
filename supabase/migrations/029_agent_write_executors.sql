-- =============================================================================
-- 029 — What Hermes may write, once a human has tapped Approve
-- -----------------------------------------------------------------------------
-- The owner asked for the Telegram bot to create, update and delete records on
-- Alina's instruction, and chose that EVERY write shows an Approve card first.
-- The governance loop for that already exists (015: propose → decide_approval →
-- execute; 016: executors impersonate the approver). What was missing is the
-- set of things an executor can actually do — three actions, all of them money.
--
-- These wrappers add the studio's day-to-day records. Every one follows 016's
-- pattern exactly, and that pattern is the point:
--
--   1. Re-verify the APPROVER's role from `profiles`, server-side. The agent
--      never names its own approver — `enqueueApproval` reads `required_role`
--      from the policy table, never from the caller's arguments.
--   2. Impersonate that human transaction-locally, so the write happens under
--      THEIR RLS. The service role is how the worker connects; it is not how
--      the row gets written. RLS stays the final authority.
--   3. Stamp the row with their id, so `entered_by`/`created_by` names a person.
--      A record created this way is indistinguishable from one they typed —
--      which is correct, because they authorised it.
--
-- DELETES are here too, by owner decision, and are the reason the re-verify in
-- step 1 matters most. Note what is NOT deletable and cannot be made so: the
-- append-only triggers (013) refuse UPDATE and DELETE on `audit_log` and
-- `ledger_entries` for EVERY role including the service role, so no wrapper
-- below can remove financial history. A mistyped earning can go; the ledger
-- entries it produced cannot, and must be reversed with an adjustment instead.
-- =============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------- helpers ---
-- Shared approver check. Returns the role, or raises. Kept separate so every
-- wrapper below states its own permitted set rather than hiding it.
create or replace function public.fn_agent_approver_role(
  p_approver uuid,
  p_allowed  public.user_role[]
)
returns public.user_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = p_approver and p.status = 'active';

  if v_role is null or not (v_role = any(p_allowed)) then
    raise exception 'approver % is not permitted to perform this action', p_approver
      using errcode = '42501';
  end if;
  return v_role;
end;
$$;

revoke all on function public.fn_agent_approver_role(uuid, public.user_role[]) from public, anon, authenticated;
grant execute on function public.fn_agent_approver_role(uuid, public.user_role[]) to service_role;

-- Impersonate the approver for the remainder of the transaction.
create or replace function public.fn_agent_impersonate(
  p_approver uuid,
  p_role     public.user_role
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_approver::text, 'user_role', p_role::text, 'aal', 'aal2')::text,
    true
  );
$$;

revoke all on function public.fn_agent_impersonate(uuid, public.user_role) from public, anon, authenticated;
grant execute on function public.fn_agent_impersonate(uuid, public.user_role) to service_role;

-- ---------------------------------------------------------------- earnings ---
create or replace function public.fn_agent_record_earning(
  p_approver           uuid,
  p_platform_account_id uuid,
  p_period_start       date,
  p_period_end         date,
  p_gross              numeric,
  p_fee                numeric,
  p_net                numeric,
  p_currency           char(3) default 'USD'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role  public.user_role;
  v_model uuid;
  v_id    uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  -- The account decides the model, exactly as the manual form does. A
  -- client-supplied model id is never trusted on any path.
  select pa.model_id into v_model
  from public.platform_accounts pa where pa.id = p_platform_account_id;
  if v_model is null then
    raise exception 'platform account % not found', p_platform_account_id using errcode = '23503';
  end if;

  insert into public.earnings (
    model_id, platform_account_id, period_start, period_end,
    gross_amount, platform_fee_amount, net_amount, currency, entered_by, source
  )
  values (
    v_model, p_platform_account_id, p_period_start, p_period_end,
    p_gross, coalesce(p_fee, 0), p_net, coalesce(p_currency, 'USD'), p_approver, 'import'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- sessions ---
create or replace function public.fn_agent_record_session(
  p_approver            uuid,
  p_platform_account_id uuid,
  p_started_at          timestamptz,
  -- Nullable: an OPEN session has no end time yet.
  p_ended_at            timestamptz default null,
  p_gross               numeric default 0,
  p_currency            char(3) default 'USD',
  p_notes               text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role  public.user_role;
  v_model uuid;
  v_id    uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  select pa.model_id into v_model
  from public.platform_accounts pa where pa.id = p_platform_account_id;
  if v_model is null then
    raise exception 'platform account % not found', p_platform_account_id using errcode = '23503';
  end if;

  insert into public.work_sessions (
    model_id, platform_account_id, started_at, ended_at,
    gross_earnings, currency, notes, entered_by, source
  )
  values (
    v_model, p_platform_account_id, p_started_at, p_ended_at,
    coalesce(p_gross, 0), coalesce(p_currency, 'USD'), p_notes, p_approver, 'import'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- expenses ---
create or replace function public.fn_agent_record_expense(
  p_approver    uuid,
  p_incurred_on date,
  p_vendor      text,
  p_amount      numeric,
  p_description text default null,
  p_category    text default null,
  p_currency    char(3) default 'USD'
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

  insert into public.expenses (
    incurred_on, vendor, amount, description, category, currency, created_by, source
  )
  values (
    p_incurred_on, p_vendor, p_amount, p_description, p_category,
    coalesce(p_currency, 'USD'), p_approver, 'import'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------- document metadata ---
create or replace function public.fn_agent_update_document(
  p_approver    uuid,
  p_document_id uuid,
  p_title       text default null,
  p_doc_type    public.document_type default null,
  p_issued_date date default null,
  p_expires_at  date default null
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

  -- Only the fields actually supplied change. This path SETS values; it is
  -- never a way to clear a compliance date to nothing.
  update public.documents d
     set title       = coalesce(p_title, d.title),
         doc_type    = coalesce(p_doc_type, d.doc_type),
         issued_date = coalesce(p_issued_date, d.issued_date),
         expires_at  = coalesce(p_expires_at, d.expires_at)
   where d.id = p_document_id
  returning d.id into v_id;

  if v_id is null then
    raise exception 'document % not found', p_document_id using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------- deletes ---
-- One function, an explicit whitelist of tables, and nothing resembling
-- dynamic SQL. `audit_log` and `ledger_entries` are absent and unreachable —
-- 013's statement triggers refuse them for every role anyway, so a mistyped
-- earning can be removed while the ledger entries it produced must be reversed
-- with an adjustment, which is a deliberate human act.
create or replace function public.fn_agent_delete_record(
  p_approver uuid,
  p_kind     text,
  p_id       uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role    public.user_role;
  v_deleted integer := 0;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_kind = 'earning' then
    delete from public.earnings where id = p_id;
  elsif p_kind = 'work_session' then
    delete from public.work_sessions where id = p_id;
  elsif p_kind = 'expense' then
    delete from public.expenses where id = p_id;
  else
    -- Unknown kinds fail closed, the same instinct as resolvePolicy: a name
    -- nobody wrote down here is refused, never guessed at.
    raise exception 'agent may not delete "%"', p_kind using errcode = '42501';
  end if;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- ------------------------------------------------------------------ grants ---
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agent_record_earning(uuid, uuid, date, date, numeric, numeric, numeric, char)',
    'public.fn_agent_record_session(uuid, uuid, timestamptz, timestamptz, numeric, char, text)',
    'public.fn_agent_record_expense(uuid, date, text, numeric, text, text, char)',
    'public.fn_agent_update_document(uuid, uuid, text, public.document_type, date, date)',
    'public.fn_agent_delete_record(uuid, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on function public.fn_agent_delete_record(uuid, text, uuid) is
  'Deletes one record on behalf of an approving human, under their RLS. Whitelisted kinds only; audit_log and ledger_entries are absent and are refused by 013 regardless (029).';
