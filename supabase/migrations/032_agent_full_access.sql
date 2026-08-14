-- =============================================================================
-- 032 — Full access: the last human-only actions, and deletes for everything
-- -----------------------------------------------------------------------------
-- The owner's directive, scoped by four decisions taken 2026-08-14:
--
--   1. `ledger_entries` and `audit_log` STAY append-only. 013's statement
--      triggers are untouched by this migration and nothing below names either
--      table as deletable. Money history is corrected by reversing entries.
--   2. No raw SQL. Every function here has a fixed shape; `fn_agent_delete_record`
--      remains an explicit whitelist with nothing resembling dynamic SQL.
--   3. Every write still requires one Approve tap through the governance loop.
--   4. Alina is promoted to super_admin (separate, owner-run step), which is
--      how the SA-only gates below open for her — no role rule is widened.
--
-- ⚠ TWO DOCUMENTED CONTROLS ARE RELAXED HERE, BY OWNER DECISION, stated
-- plainly as 031 stated the approve_payout relaxation:
--
--   * `mark_payout_paid` was human_only — settlement was a portal-side act.
--     It becomes approvable from Telegram. What is kept: only an APPROVED
--     payout can be marked paid (007's state machine runs under the approver's
--     claims), `payout_paid_settlement` remains the sole writer of settlement
--     ledger entries, and the settlement row is attributed to the human.
--   * `delete_document` was human_only with NO code path anywhere — the portal
--     has no document delete at all. It becomes a real, approvable action.
--
-- HARD DELETES leave no automatic trail: every audit trigger in 007 is AFTER
-- INSERT/UPDATE only. So every delete below writes its own `audit_log` row
-- with a jsonb snapshot of what was removed — durable, because audit_log is
-- protected by the very append-only trigger this migration leaves standing.
-- =============================================================================

set search_path = public, extensions;

-- ------------------------------------------------------------ audit helper ---
-- One writer for the delete trail. INSERT into audit_log is permitted (013
-- refuses only UPDATE/DELETE), and the snapshot is what makes a hard delete
-- reconstructable after the fact.
create or replace function public.fn_agent_audit_delete(
  p_actor    uuid,
  p_role     public.user_role,
  p_kind     text,
  p_id       uuid,
  p_snapshot jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    p_actor, p_role, p_kind || '.delete', p_kind, p_id::text,
    jsonb_build_object('via', 'hermes', 'snapshot', coalesce(p_snapshot, '{}'::jsonb))
  );
$$;

revoke all on function public.fn_agent_audit_delete(uuid, public.user_role, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_agent_audit_delete(uuid, public.user_role, text, uuid, jsonb) to service_role;

-- ------------------------------------------------------- mark a payout paid ---
create or replace function public.fn_agent_mark_payout_paid(
  p_approver  uuid,
  p_payout_id uuid,
  p_reference text default null,
  p_method    text default null
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
  -- Idempotent on retry: a first attempt that committed but lost its response
  -- comes back here seeing 'paid'. Returning success (not raising) is what
  -- stops the executor from driving the approval to 'failed' and alerting the
  -- owner that a genuinely-paid payout failed. The settlement row is already
  -- posted and ledger_payout_settlement_unique guarantees it is the only one.
  if v_status = 'paid' then
    return p_payout_id;
  end if;
  if v_status <> 'approved' then
    raise exception 'that payout is % — only an approved payout can be marked paid', v_status
      using errcode = '23514';
  end if;

  -- Status only. `payout_paid_settlement` (007) fires on this UPDATE, under
  -- the impersonated claims, and posts the one settlement ledger entry —
  -- attributed to the approver, guarded by ledger_payout_settlement_unique,
  -- so a replay cannot post twice.
  update public.payouts p
     set status         = 'paid',
         reference      = coalesce(p_reference, p.reference),
         payment_method = coalesce(p_method, p.payment_method)
   where p.id = p_payout_id
  returning p.id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------ cancel payout ---
create or replace function public.fn_agent_cancel_payout(
  p_approver  uuid,
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
  -- Widest set first; the per-state narrowing below mirrors the portal's
  -- split, re-implemented explicitly because RLS is not evaluated in here.
  v_role := public.fn_agent_approver_role(
    p_approver, array['super_admin','manager','finance']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  select p.status into v_status from public.payouts p where p.id = p_payout_id;
  if v_status is null then
    raise exception 'payout % not found', p_payout_id using errcode = 'P0002';
  end if;
  if v_status = 'paid' then
    raise exception 'that payout was already paid — it can only be adjusted, not cancelled'
      using errcode = '23514';
  end if;
  -- Idempotent on retry: a committed-but-lost first cancel sees 'cancelled'
  -- and returns success rather than raising a false failure.
  if v_status = 'cancelled' then
    return p_payout_id;
  end if;
  if v_status = 'approved' and v_role <> 'super_admin' then
    raise exception 'an approved payout can only be cancelled by a super admin'
      using errcode = '42501';
  end if;

  update public.payouts p
     set status = 'cancelled'
   where p.id = p_payout_id
  returning p.id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------- delete document ---
-- Returns the storage_path so the WORKER can remove the object — storage
-- lives behind the Storage API, not SQL. Null return = already gone, which
-- makes a retry after a crash between row and object idempotent.
create or replace function public.fn_agent_delete_document(
  p_approver    uuid,
  p_document_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_row  public.documents%rowtype;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  select * into v_row from public.documents d where d.id = p_document_id;
  if v_row.id is null then
    return null; -- already gone
  end if;

  -- No FK binds extractions to their source, by design (021) — explicit here.
  delete from public.doc_extractions x
   where x.source_kind = 'document' and x.source_id = p_document_id;

  -- Shares cascade, and share views cascade off shares (002).
  delete from public.documents d where d.id = p_document_id;

  perform public.fn_agent_audit_delete(
    p_approver, v_role, 'document', p_document_id,
    jsonb_build_object(
      'title', v_row.title, 'doc_type', v_row.doc_type, 'model_id', v_row.model_id,
      'expires_at', v_row.expires_at, 'storage_path', v_row.storage_path));

  return v_row.storage_path;
end;
$$;

-- --------------------------------------------------- deletes, whole studio ---
-- The original three kinds keep their manager gate; every entity kind added
-- here is SUPER ADMIN only and pre-checked so a refusal arrives as a sentence
-- naming what blocks, with counts — never a raw SQLSTATE after the tap.
--
-- Two checks are POLICY, not FK, and deliberately so:
--   * a model/operator with ledger or payout history is refused even though no
--     FK would stop it — `ledger_entries.payee_id` and `payouts.payee_id` are
--     polymorphic and unenforced, and deleting the payee would leave a real
--     balance under a name that no longer resolves (a ghost payee).
--   * a paid payout is refused before the FK would catch it, because the
--     honest sentence ("its settlement is in the append-only ledger") beats
--     23503.
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
  v_snap    jsonb;
  n1 integer; n2 integer; n3 integer; n4 integer; n5 integer;
  v_status  public.payout_status;
  v_parts   text[];
begin
  -- Day-to-day records: manager or super_admin, as in 029.
  if p_kind in ('earning', 'work_session', 'expense') then
    v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  else
    v_role := public.fn_agent_approver_role(p_approver, array['super_admin']::public.user_role[]);
  end if;
  perform public.fn_agent_impersonate(p_approver, v_role);

  if p_kind = 'earning' then
    -- Retrofit: this used to fail with a raw 23503 after the Approve tap.
    select count(*) into n1 from public.ledger_entries le where le.earning_id = p_id;
    if n1 > 0 then
      raise exception
        '% ledger entries were posted from this earning — reverse them with an adjustment instead of deleting', n1
        using errcode = '23514';
    end if;
    select to_jsonb(e) - 'created_at' into v_snap from public.earnings e where e.id = p_id;
    delete from public.earnings where id = p_id;

  elsif p_kind = 'work_session' then
    select to_jsonb(w) - 'created_at' into v_snap from public.work_sessions w where w.id = p_id;
    delete from public.work_sessions where id = p_id;

  elsif p_kind = 'expense' then
    select to_jsonb(x) - 'created_at' into v_snap from public.expenses x where x.id = p_id;
    delete from public.expenses where id = p_id;

  elsif p_kind = 'model' then
    select count(*) into n1 from public.ledger_entries le
     where (le.payee_type = 'model' and le.payee_id = p_id)
        or le.earning_id in (select e.id from public.earnings e where e.model_id = p_id);
    select count(*) into n2 from public.payouts po
     where po.payee_type = 'model' and po.payee_id = p_id;
    select count(*) into n3 from public.documents d where d.model_id = p_id;
    select count(*) into n4 from public.commission_schemes cs where cs.model_id = p_id;
    select count(*) into n5 from public.forecast_snapshots fs where fs.model_id = p_id;

    v_parts := array[]::text[];
    if n1 > 0 then v_parts := v_parts || format('%s ledger entries', n1); end if;
    if n2 > 0 then v_parts := v_parts || format('%s payouts', n2); end if;
    if n3 > 0 then v_parts := v_parts || format('%s documents', n3); end if;
    if n4 > 0 then v_parts := v_parts || format('%s commission schemes', n4); end if;
    if n5 > 0 then v_parts := v_parts || format('%s forecast snapshots', n5); end if;
    if array_length(v_parts, 1) is not null then
      raise exception
        'she has % — delete or resolve those first, or archive her instead (history stays intact)',
        array_to_string(v_parts, ', ')
        using errcode = '23514';
    end if;

    select to_jsonb(m) - 'created_at' into v_snap from public.models m where m.id = p_id;
    -- Explicit order avoids the RESTRICT-vs-CASCADE hazard: accounts cascade
    -- from the model, but earnings/sessions RESTRICT on the account.
    delete from public.earnings e where e.model_id = p_id;
    delete from public.work_sessions w where w.model_id = p_id;
    delete from public.models m where m.id = p_id;

  elsif p_kind = 'operator' then
    select count(*) into n1 from public.operator_assignments a where a.operator_id = p_id;
    select count(*) into n2 from public.ledger_entries le
     where le.payee_type = 'operator' and le.payee_id = p_id;
    select count(*) into n3 from public.payouts po
     where po.payee_type = 'operator' and po.payee_id = p_id;

    v_parts := array[]::text[];
    if n1 > 0 then v_parts := v_parts || format('%s assignments (end or delete them first)', n1); end if;
    if n2 > 0 then v_parts := v_parts || format('%s ledger entries', n2); end if;
    if n3 > 0 then v_parts := v_parts || format('%s payouts', n3); end if;
    if array_length(v_parts, 1) is not null then
      raise exception
        'this team member has % — archive them instead (history stays intact)',
        array_to_string(v_parts, ', ')
        using errcode = '23514';
    end if;

    select to_jsonb(o) - 'created_at' - 'payment_details' into v_snap
      from public.operators o where o.id = p_id;
    delete from public.operators o where o.id = p_id;

  elsif p_kind = 'platform' then
    select count(*) into n1 from public.platform_accounts a where a.platform_id = p_id;
    select count(*) into n2 from public.forecast_snapshots fs where fs.platform_id = p_id;
    if n1 > 0 or n2 > 0 then
      raise exception
        'this platform has % accounts and % forecast snapshots — remove those first, or deactivate it instead',
        n1, n2
        using errcode = '23514';
    end if;
    select to_jsonb(p) into v_snap from public.platforms p where p.id = p_id;
    delete from public.platforms p where p.id = p_id;

  elsif p_kind = 'account' then
    select count(*) into n1 from public.earnings e where e.platform_account_id = p_id;
    select count(*) into n2 from public.work_sessions w where w.platform_account_id = p_id;
    select count(*) into n3 from public.commission_schemes cs where cs.platform_account_id = p_id;
    if n1 > 0 or n2 > 0 or n3 > 0 then
      raise exception
        'this account has % earnings, % sessions and % schemes recorded against it — delete those first, or close the account instead',
        n1, n2, n3
        using errcode = '23514';
    end if;
    select to_jsonb(a) - 'created_at' into v_snap from public.platform_accounts a where a.id = p_id;
    delete from public.platform_accounts a where a.id = p_id;

  elsif p_kind = 'assignment' then
    -- No inbound FKs. The caution (historical re-runs resolve differently
    -- without it) belongs on the card, and the card carries it.
    select to_jsonb(a) - 'created_at' into v_snap from public.operator_assignments a where a.id = p_id;
    delete from public.operator_assignments a where a.id = p_id;

  elsif p_kind = 'scheme' then
    if exists (
      select 1 from public.commission_schemes cs
      where cs.id = p_id and cs.model_id is null and cs.platform_account_id is null
    ) then
      raise exception
        'that is the studio-wide default scheme — every model without her own scheme depends on it; edit it instead'
        using errcode = '23514';
    end if;
    select count(*) into n1 from public.ledger_entries le where le.commission_scheme_id = p_id;
    if n1 > 0 then
      raise exception
        'this scheme already posted % ledger entries — end-date it instead of deleting', n1
        using errcode = '23514';
    end if;
    -- The rate card CASCADEs away with it; the card said so before the tap.
    select to_jsonb(cs) - 'created_at' into v_snap from public.commission_schemes cs where cs.id = p_id;
    delete from public.commission_schemes cs where cs.id = p_id;

  elsif p_kind = 'rate_card' then
    -- p_id is the SCHEME id; this clears its per-role brackets, after which
    -- the scheme's flat three-way split applies again (025's fallback path).
    if not exists (select 1 from public.commission_schemes cs where cs.id = p_id) then
      raise exception 'scheme % not found', p_id using errcode = 'P0002';
    end if;
    select jsonb_agg(to_jsonb(r) - 'created_at') into v_snap
      from public.commission_rates r where r.scheme_id = p_id;
    delete from public.commission_rates r where r.scheme_id = p_id;

  elsif p_kind = 'payout' then
    select po.status into v_status from public.payouts po where po.id = p_id;
    if v_status = 'paid' then
      raise exception
        'that payout was paid and its settlement is in the append-only ledger — it is permanent; adjust instead'
        using errcode = '23514';
    end if;
    if v_status = 'approved' then
      raise exception 'cancel the approved payout first, then delete it' using errcode = '23514';
    end if;
    select to_jsonb(po) - 'created_at' into v_snap from public.payouts po where po.id = p_id;
    delete from public.payouts po where po.id = p_id;

  else
    -- Unknown kinds fail closed. `ledger_entry` and `audit_log` are not kinds
    -- and can never become ones — 013 refuses them below any wrapper anyway.
    raise exception 'agent may not delete "%"', p_kind using errcode = '42501';
  end if;

  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    perform public.fn_agent_audit_delete(p_approver, v_role, p_kind, p_id, v_snap);
  end if;
  return v_deleted > 0;
end;
$$;

-- ---------------------------------------------------------------- S8 columns ---
-- Where a card lives, so a superseded approval's buttons can be neutralised
-- and a duplicate instruction can point back at the original card.
alter table public.hermes_approvals
  add column if not exists source_chat_id  text,
  add column if not exists card_message_id text,
  add column if not exists supersede_key   text;

comment on column public.hermes_approvals.source_chat_id is
  'Telegram chat the proposing conversation ran in (032). One half of the supersede scope.';
comment on column public.hermes_approvals.card_message_id is
  'Telegram message id of the approval card (032), so supersede can edit the stale card and neutralise its buttons.';
comment on column public.hermes_approvals.supersede_key is
  'Entity identity as ${action_type}:${id_field}:${uuid} (032). Supersede retires a prior pending proposal ONLY when this matches exactly — so two distinct payouts/documents/records never cancel each other. Null for pure creates, which never supersede.';

-- Supersede scans pending rows by (source_chat_id, supersede_key); index it so
-- the scan on every propose stays a lookup, not a table walk.
create index if not exists hermes_approvals_supersede_idx
  on public.hermes_approvals (source_chat_id, supersede_key)
  where state = 'pending';

-- -------------------------------------------------------------------- grants ---
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agent_mark_payout_paid(uuid, uuid, text, text)',
    'public.fn_agent_cancel_payout(uuid, uuid)',
    'public.fn_agent_delete_document(uuid, uuid)',
    'public.fn_agent_delete_record(uuid, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on function public.fn_agent_mark_payout_paid(uuid, uuid, text, text) is
  'Marks an approved payout paid on behalf of an approving super_admin (032). Relaxes the docs/03 §110 settlement split by owner decision; 007''s state machine and settlement trigger run under the approver''s claims.';

comment on function public.fn_agent_delete_record(uuid, text, uuid) is
  'Deletes one record on behalf of an approving human (029, widened 032). Original three kinds stay manager-approvable; entity kinds are super_admin-only, pre-checked into prose, and audited with a snapshot. audit_log and ledger_entries are absent and refused by 013 for every role regardless.';
