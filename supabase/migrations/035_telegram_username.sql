-- =============================================================================
-- 035 — People carry a Telegram username
-- -----------------------------------------------------------------------------
-- Requested from the field, day one of real use: Alina added an operator and
-- said "telegram юзернейм @hahaub", and the bot had to answer that no such
-- field exists anywhere. It is how the studio actually identifies people, so
-- it becomes a first-class attribute of models and team members alike.
--
-- Stored WITHOUT the @ and constrained to Telegram's own username rules
-- (5–32 chars, letters/digits/underscore). Validation in the shared fields
-- modules strips a pasted @ before it gets here; the CHECK is the last word.
--
-- The two upsert wrappers gain the parameter. Postgres treats an added
-- defaulted parameter as a NEW OVERLOAD, and two overloads make every
-- PostgREST rpc call ambiguous — so the old signatures are DROPPED first,
-- and the grants are restated for the new ones.
-- =============================================================================

set search_path = public, extensions;

alter table public.models
  add column if not exists telegram_username text,
  add constraint models_tg_username_chk
    check (telegram_username is null or telegram_username ~ '^[A-Za-z0-9_]{5,32}$');

alter table public.operators
  add column if not exists telegram_username text,
  add constraint operators_tg_username_chk
    check (telegram_username is null or telegram_username ~ '^[A-Za-z0-9_]{5,32}$');

comment on column public.operators.telegram_username is
  'Telegram handle without the @, how the studio addresses people day to day (035).';
comment on column public.models.telegram_username is
  'Telegram handle without the @ (035).';

-- ------------------------------------------------------------------ wrappers ---

drop function if exists public.fn_agent_upsert_operator(uuid, uuid, text, text, public.staff_role, text, text, char, date, text);

create or replace function public.fn_agent_upsert_operator(
  p_approver          uuid,
  p_operator_id       uuid default null,
  p_display_name      text default null,
  p_legal_name        text default null,
  p_staff_role        public.staff_role default null,
  p_email             text default null,
  p_phone             text default null,
  p_country           char(2) default null,
  p_start_date        date default null,
  p_notes             text default null,
  p_telegram_username text default null
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
      start_date, notes, telegram_username, created_by
    )
    values (
      p_display_name, p_legal_name, coalesce(p_staff_role, 'operator'),
      p_email, p_phone, p_country, p_start_date, p_notes, p_telegram_username, p_approver
    )
    returning id into v_id;
  else
    update public.operators o
       set display_name      = coalesce(p_display_name, o.display_name),
           legal_name        = coalesce(p_legal_name, o.legal_name),
           staff_role        = coalesce(p_staff_role, o.staff_role),
           email             = coalesce(p_email, o.email),
           phone             = coalesce(p_phone, o.phone),
           country           = coalesce(p_country, o.country),
           start_date        = coalesce(p_start_date, o.start_date),
           notes             = coalesce(p_notes, o.notes),
           telegram_username = coalesce(p_telegram_username, o.telegram_username)
     where o.id = p_operator_id
    returning o.id into v_id;

    if v_id is null then
      raise exception 'team member % not found', p_operator_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

drop function if exists public.fn_agent_upsert_model(uuid, uuid, text, text, date, numeric, public.model_status, text, text, text);

create or replace function public.fn_agent_upsert_model(
  p_approver           uuid,
  p_model_id           uuid default null,
  p_stage_name         text default null,
  p_legal_name         text default null,
  p_date_of_birth      date default null,
  p_commission_percent numeric default null,
  p_status             public.model_status default null,
  p_email              text default null,
  p_phone              text default null,
  p_country            text default null,
  p_telegram_username  text default null
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

  if p_model_id is null then
    if p_stage_name is null or p_legal_name is null or p_date_of_birth is null then
      raise exception 'a new model needs a stage name, legal name and date of birth'
        using errcode = '23502';
    end if;
    insert into public.models (
      stage_name, legal_name, date_of_birth, commission_percent,
      status, email, phone, country, telegram_username, created_by
    )
    values (
      p_stage_name, p_legal_name, p_date_of_birth, coalesce(p_commission_percent, 60),
      coalesce(p_status, 'active'), p_email, p_phone, p_country, p_telegram_username, p_approver
    )
    returning id into v_id;
  else
    update public.models m
       set stage_name         = coalesce(p_stage_name, m.stage_name),
           legal_name         = coalesce(p_legal_name, m.legal_name),
           date_of_birth      = coalesce(p_date_of_birth, m.date_of_birth),
           commission_percent = coalesce(p_commission_percent, m.commission_percent),
           status             = coalesce(p_status, m.status),
           email              = coalesce(p_email, m.email),
           phone              = coalesce(p_phone, m.phone),
           country            = coalesce(p_country, m.country),
           telegram_username  = coalesce(p_telegram_username, m.telegram_username)
     where m.id = p_model_id
    returning m.id into v_id;

    if v_id is null then
      raise exception 'model % not found', p_model_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agent_upsert_operator(uuid, uuid, text, text, public.staff_role, text, text, char, date, text, text)',
    'public.fn_agent_upsert_model(uuid, uuid, text, text, date, numeric, public.model_status, text, text, text, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
