-- =============================================================================
-- 007_triggers.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- Every trigger in the system: updated_at maintenance, invite-only signup,
-- polymorphic-payee validation, the cross-row operator-pool rule, the payout
-- state machine and its settlement entry, app_settings validation, and the
-- audit-log writers for the dotted-verb action catalogue.
--
-- Source of truth: docs/04-database-erd.md §9 (trigger inventory) and §4.16
-- (action catalogue), docs/09-accounting.md §4.3/§6, docs/11-ai-llm.md §3/§7.
--
-- Why the trigger functions are SECURITY DEFINER:
--   * audit writers insert into audit_log, on which NO role holds INSERT — the
--     absence of a policy is the append-only enforcement, so the writer must be
--     the table owner;
--   * payout_paid_settlement inserts the one ledger entry no human may post;
--   * check_operator_pool and the payee validators must see ALL sibling rows, not
--     the caller's RLS-filtered subset, or the rule they enforce is unsound.
-- All of them SET search_path = '' and reference every object schema-qualified.
--
-- One trigger beyond the docs/04 §9 inventory: enforce_payout_transition. An RLS
-- WITH CHECK cannot compare the new row against the old one, so the WITH CHECK
-- clauses in 008 can forbid finance from *writing* 'approved' but cannot express
-- "'paid' only from 'approved'". This trigger closes that gap; the policies stay
-- exactly as specified and this is strictly additional enforcement.
-- =============================================================================

set search_path = public, extensions;

-- =============================================================================
-- 1. updated_at maintenance
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'models', 'operators', 'platform_accounts', 'work_sessions',
    'earnings', 'payouts', 'documents', 'app_settings', 'ai_conversations',
    'library_files'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- =============================================================================
-- 2. handle_new_user — invite-only signup (docs/05 §3)
-- =============================================================================
-- Defense-in-depth behind the disabled public-signup setting: an auth.users row
-- with no matching *pending, unexpired* invitation aborts the signup outright.
-- The profile is created with status 'invited'; activation happens on successful
-- TOTP enrollment through the guarded service-role path, so a half-provisioned
-- account reads zero rows via is_active_profile().
--
-- Email matching is done on lower(text) rather than citext equality on purpose:
-- inside SET search_path = '' the citext operator family is not visible, and a
-- silent fallback to text equality would be case-SENSITIVE.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv       public.invitations%rowtype;
  v_full_name text;
begin
  select i.*
    into v_inv
  from public.invitations i
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email::text) = lower(new.email)
  order by i.created_at desc
  limit 1;

  if v_inv.id is null then
    raise exception 'Invite-only system: no pending invitation exists for %', new.email
      using errcode = '42501';
  end if;

  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, role, full_name, email, status)
  values (new.id, v_inv.role, v_full_name, new.email::extensions.citext, 'invited')
  on conflict (id) do nothing;

  -- Pre-linked business records gain their self-service login.
  if v_inv.model_id is not null then
    update public.models
       set profile_id = new.id
     where id = v_inv.model_id
       and profile_id is null;
  end if;

  if v_inv.operator_id is not null then
    update public.operators
       set profile_id = new.id
     where id = v_inv.operator_id
       and profile_id is null;
  end if;

  update public.invitations
     set status = 'accepted',
         accepted_at = now()
   where id = v_inv.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 3. Polymorphic-payee validation (docs/04 §4.10 / §4.11)
-- =============================================================================
create or replace function public.validate_ledger_payee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payee_type = 'model' then
    if not exists (select 1 from public.models m where m.id = new.payee_id) then
      raise exception 'ledger_entries.payee_id % is not a models row', new.payee_id
        using errcode = '23503';
    end if;
  elsif new.payee_type = 'operator' then
    if not exists (select 1 from public.operators o where o.id = new.payee_id) then
      raise exception 'ledger_entries.payee_id % is not an operators row', new.payee_id
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_ledger_payee on public.ledger_entries;
create trigger validate_ledger_payee
  before insert on public.ledger_entries
  for each row execute function public.validate_ledger_payee();

create or replace function public.validate_payout_payee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payee_type = 'model' then
    if not exists (select 1 from public.models m where m.id = new.payee_id) then
      raise exception 'payouts.payee_id % is not a models row', new.payee_id
        using errcode = '23503';
    end if;
  elsif new.payee_type = 'operator' then
    if not exists (select 1 from public.operators o where o.id = new.payee_id) then
      raise exception 'payouts.payee_id % is not an operators row', new.payee_id
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_payout_payee on public.payouts;
create trigger validate_payout_payee
  before insert or update of payee_type, payee_id on public.payouts
  for each row execute function public.validate_payout_payee();

-- =============================================================================
-- 4. check_operator_pool — the cross-row rule a CHECK cannot express (04 §4.8)
-- =============================================================================
-- Per model, the pool_share_percent values of assignments live on any given date
-- must sum to at most 100. The sum is piecewise constant and only ever steps UP
-- at an interval start, so evaluating it at every start date inside the affected
-- window is exact. Under-assignment (< 100) is legal: the remainder falls to the
-- studio (docs/09 §4.3).
create or replace function public.check_operator_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric(6,2);
begin
  with cand as (
    select a.assigned_from as s,
           coalesce(a.assigned_to, 'infinity'::date) as e,
           a.pool_share_percent as p
    from public.operator_assignments a
    where a.model_id = new.model_id
      and a.id <> new.id
      and daterange(a.assigned_from, a.assigned_to, '[]')
          && daterange(new.assigned_from, new.assigned_to, '[]')
    union all
    select new.assigned_from,
           coalesce(new.assigned_to, 'infinity'::date),
           new.pool_share_percent
  ),
  points as (
    select distinct c.s as d from cand c
  )
  select max(t.total)
    into v_max
  from (
    select p.d, sum(c.p) as total
    from points p
    join cand c on p.d between c.s and c.e
    group by p.d
  ) t;

  if v_max is not null and v_max > 100 then
    raise exception
      'operator pool for model % would reach % percent on at least one date (max 100)',
      new.model_id, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists check_operator_pool on public.operator_assignments;
create trigger check_operator_pool
  before insert or update on public.operator_assignments
  for each row execute function public.check_operator_pool();

-- =============================================================================
-- 5. Payout state machine + settlement (docs/09 §6)
-- =============================================================================
-- BEFORE UPDATE: legal transitions only, approval reserved to super_admin,
-- settlement reserved to finance/super_admin, and the audit stamps filled in.
-- current_user_role() is NULL only outside an end-user session (service role /
-- migration), which is a trusted server path that has already verified role and
-- AAL2 before instantiating the privileged client (docs/05 §7).
create or replace function public.enforce_payout_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending'  and new.status in ('approved', 'cancelled')) or
      (old.status = 'approved' and new.status in ('paid', 'cancelled'))
    ) then
      raise exception 'illegal payout status transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status = 'approved' then
      if v_role is not null and v_role <> 'super_admin' then
        raise exception 'only super_admin may approve a payout' using errcode = '42501';
      end if;
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;

    if new.status = 'paid' then
      if v_role is not null and v_role not in ('super_admin', 'finance') then
        raise exception 'only finance or super_admin may record settlement' using errcode = '42501';
      end if;
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_payout_transition on public.payouts;
create trigger enforce_payout_transition
  before update on public.payouts
  for each row execute function public.enforce_payout_transition();

-- AFTER UPDATE: the transition to 'paid' posts the negative settlement entry.
-- This trigger is the ONLY writer of payout_settlement entries, which is what
-- keeps payouts and ledger_entries permanently consistent (docs/04 §4.11).
create or replace function public.payout_paid_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
     and old.status is distinct from 'paid'
     and new.net_amount <> 0 then

    insert into public.ledger_entries (
      payee_type, payee_id, entry_type, amount, currency,
      period_start, period_end, payout_id, description, created_by
    )
    values (
      new.payee_type,
      new.payee_id,
      'payout_settlement',
      -abs(new.net_amount),
      new.currency,
      new.period_start,
      new.period_end,
      new.id,
      'Settlement of payout ' || new.id::text,
      coalesce(auth.uid(), new.created_by)
    )
    on conflict do nothing;
  end if;

  return null;
end;
$$;

drop trigger if exists payout_paid_settlement on public.payouts;
create trigger payout_paid_settlement
  after update on public.payouts
  for each row execute function public.payout_paid_settlement();

-- =============================================================================
-- 6. validate_app_setting — typed configuration guard (docs/04 §4.18, 11 §3)
-- =============================================================================
-- Every known ai.* key is validated here; an unrecognized ai.* key is rejected
-- outright, so adding one is a deliberate migration that updates this function
-- alongside the seed.
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
    if jsonb_typeof(new.value) <> 'string' or v_text not in ('moonshot', 'zhipu') then
      raise exception '% must be "moonshot" or "zhipu"', new.key using errcode = '22023';
    end if;

  elsif new.key in ('ai.chat_model.moonshot', 'ai.chat_model.zhipu',
                    'ai.vision_model.moonshot', 'ai.vision_model.zhipu',
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

drop trigger if exists validate_app_setting on public.app_settings;
create trigger validate_app_setting
  before insert or update on public.app_settings
  for each row execute function public.validate_app_setting();

-- =============================================================================
-- 7. Audit writers (docs/04 §4.16 dotted-verb catalogue)
-- =============================================================================
-- write_audit is the single insertion point into the append-only trail. EXECUTE
-- is revoked from every client role: only the SECURITY DEFINER trigger functions
-- below (and service-role server paths writing the table directly) can reach it,
-- so no session can forge an audit row.
create or replace function public.write_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    public.current_user_role(),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;

-- profiles ---------------------------------------------------------------
create or replace function public.tg_audit_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('user.create', 'profiles', new.id::text,
      jsonb_build_object('role', new.role, 'status', new.status));
  else
    if new.role is distinct from old.role then
      perform public.write_audit('user.role_change', 'profiles', new.id::text,
        jsonb_build_object('from', old.role, 'to', new.role));
    elsif new.status is distinct from old.status then
      perform public.write_audit(
        case when new.status = 'deactivated' then 'user.deactivate' else 'user.status_change' end,
        'profiles', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after insert or update on public.profiles
  for each row execute function public.tg_audit_profiles();

-- invitations ------------------------------------------------------------
create or replace function public.tg_audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('user.invite', 'invitations', new.id::text,
      jsonb_build_object('email', new.email::text, 'role', new.role,
                         'model_id', new.model_id, 'operator_id', new.operator_id));
  elsif new.status is distinct from old.status then
    perform public.write_audit('user.invite_' || new.status::text, 'invitations', new.id::text,
      jsonb_build_object('email', new.email::text, 'from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;

drop trigger if exists audit_invitations on public.invitations;
create trigger audit_invitations
  after insert or update on public.invitations
  for each row execute function public.tg_audit_invitations();

-- commission_schemes -----------------------------------------------------
create or replace function public.tg_audit_commission_schemes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.write_audit(
    case when tg_op = 'INSERT' then 'scheme.create' else 'scheme.update' end,
    'commission_schemes', new.id::text,
    jsonb_build_object(
      'model_id', new.model_id,
      'platform_account_id', new.platform_account_id,
      'model_percent', new.model_percent,
      'operator_percent', new.operator_percent,
      'studio_percent', new.studio_percent,
      'effective_from', new.effective_from,
      'effective_to', new.effective_to));
  return null;
end;
$$;

drop trigger if exists audit_commission_schemes on public.commission_schemes;
create trigger audit_commission_schemes
  after insert or update on public.commission_schemes
  for each row execute function public.tg_audit_commission_schemes();

-- payouts ----------------------------------------------------------------
create or replace function public.tg_audit_payouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'payout.create';
    perform public.write_audit(v_action, 'payouts', new.id::text,
      jsonb_build_object('payee_type', new.payee_type, 'payee_id', new.payee_id,
                         'net_amount', new.net_amount, 'currency', new.currency,
                         'status', new.status));
    return null;
  end if;

  if new.status is distinct from old.status then
    v_action := case new.status
                  when 'approved'  then 'payout.approve'
                  when 'paid'      then 'payout.paid'
                  when 'cancelled' then 'payout.cancel'
                  else 'payout.update'
                end;
  else
    v_action := 'payout.update';
  end if;

  perform public.write_audit(v_action, 'payouts', new.id::text,
    jsonb_build_object('payee_type', new.payee_type, 'payee_id', new.payee_id,
                       'net_amount', new.net_amount, 'currency', new.currency,
                       'from', old.status, 'to', new.status));
  return null;
end;
$$;

drop trigger if exists audit_payouts on public.payouts;
create trigger audit_payouts
  after insert or update on public.payouts
  for each row execute function public.tg_audit_payouts();

-- ledger_entries ---------------------------------------------------------
create or replace function public.tg_audit_ledger_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.write_audit('ledger.post', 'ledger_entries', new.id::text,
    jsonb_build_object('payee_type', new.payee_type, 'payee_id', new.payee_id,
                       'entry_type', new.entry_type, 'amount', new.amount,
                       'currency', new.currency, 'earning_id', new.earning_id,
                       'payout_id', new.payout_id,
                       'commission_scheme_id', new.commission_scheme_id));
  return null;
end;
$$;

drop trigger if exists audit_ledger_entries on public.ledger_entries;
create trigger audit_ledger_entries
  after insert on public.ledger_entries
  for each row execute function public.tg_audit_ledger_entries();

-- documents --------------------------------------------------------------
create or replace function public.tg_audit_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.write_audit('document.upload', 'documents', new.id::text,
    jsonb_build_object('model_id', new.model_id, 'doc_type', new.doc_type,
                       'mime_type', new.mime_type, 'file_size_bytes', new.file_size_bytes));
  return null;
end;
$$;

drop trigger if exists audit_documents on public.documents;
create trigger audit_documents
  after insert on public.documents
  for each row execute function public.tg_audit_documents();

-- document_shares --------------------------------------------------------
-- Only creation and revocation are audited here. view_count increments are
-- written by the share-view Edge Function, which emits share.view itself.
create or replace function public.tg_audit_document_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('share.create', 'document_shares', new.id::text,
      jsonb_build_object('document_id', new.document_id, 'token_prefix', new.token_prefix,
                         'expires_at', new.expires_at, 'max_views', new.max_views,
                         'recipient_label', new.recipient_label));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.write_audit('share.revoke', 'document_shares', new.id::text,
      jsonb_build_object('document_id', new.document_id, 'token_prefix', new.token_prefix,
                         'revoked_by', new.revoked_by));
  end if;
  return null;
end;
$$;

drop trigger if exists audit_document_shares on public.document_shares;
create trigger audit_document_shares
  after insert or update on public.document_shares
  for each row execute function public.tg_audit_document_shares();

-- app_settings -----------------------------------------------------------
-- ai.active_provider changes are the governance event: a different third-party
-- data processor. They get their own verb (docs/11 §3).
create or replace function public.tg_audit_app_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value is distinct from old.value then
    perform public.write_audit(
      case when new.key = 'ai.active_provider' then 'ai.model_switch' else 'ai.settings_update' end,
      'app_settings', new.key,
      jsonb_build_object('key', new.key, 'old_value', old.value, 'new_value', new.value));
  end if;
  return null;
end;
$$;

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings
  after update on public.app_settings
  for each row execute function public.tg_audit_app_settings();

-- ai_reports -------------------------------------------------------------
create or replace function public.tg_audit_ai_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.write_audit('ai.report_create', 'ai_reports', new.id::text,
    jsonb_build_object('report_month', new.report_month, 'provider', new.provider,
                       'model', new.model, 'params', new.params));
  return null;
end;
$$;

drop trigger if exists audit_ai_reports on public.ai_reports;
create trigger audit_ai_reports
  after insert on public.ai_reports
  for each row execute function public.tg_audit_ai_reports();

-- library_files ----------------------------------------------------------
-- library.categorize covers both the classifier's suggestion and the human
-- confirmation/override that follows it — the whole point of the audit row is to
-- record who or what decided a file's filing.
create or replace function public.tg_audit_library_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('library.upload', 'library_files', new.id::text,
      jsonb_build_object('folder_path', new.folder_path, 'mime_type', new.mime_type,
                         'size_bytes', new.size_bytes, 'ai_exempt', new.ai_exempt));
  elsif new.category_id             is distinct from old.category_id
     or new.ai_suggested_category_id is distinct from old.ai_suggested_category_id
     or new.ai_status               is distinct from old.ai_status then
    perform public.write_audit('library.categorize', 'library_files', new.id::text,
      jsonb_build_object('category_id', new.category_id,
                         'previous_category_id', old.category_id,
                         'ai_suggested_category_id', new.ai_suggested_category_id,
                         'ai_status', new.ai_status,
                         'ai_confidence', new.ai_confidence,
                         'provider', new.classified_provider));
  end if;
  return null;
end;
$$;

drop trigger if exists audit_library_files on public.library_files;
create trigger audit_library_files
  after insert or update on public.library_files
  for each row execute function public.tg_audit_library_files();
