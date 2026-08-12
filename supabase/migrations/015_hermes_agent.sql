-- =============================================================================
-- 015 — Freedom Hermes: agent governance spine
-- -----------------------------------------------------------------------------
-- Introduces an always-on agent ("Hermes") that may PROPOSE actions but never
-- authorise them. docs/11 §1 previously stated "no service role anywhere in the
-- AI request path"; the owner has extended that (2026-08-12) to allow an
-- unattended worker, under the controls below. §4.1 [D6] — no raw SQL tools —
-- is NOT touched and remains absolute.
--
-- THE THREE-LAYER SAFETY STORY (copy all three or none):
--
--   1. TypeScript policy fails safe. An action absent from ACTION_POLICIES
--      resolves to tier 'approval', never 'automatic'. A prompt-injected tool
--      call cannot invent an auto-executing action.
--   2. The DB guard trigger makes a human decision impossible to forge. The
--      service role bypasses RLS but NOT triggers: decision states may only be
--      set while the transaction-local GUC `hermes.deciding` is on, and that is
--      set exclusively inside decide_approval(). So the worker can propose,
--      execute, and fail an approval — but cannot approve one.
--   3. Execution is exactly-once. The claim is a single conditional UPDATE on
--      `executed_at IS NULL`; the daily job claim is an UPSERT whose DO UPDATE
--      carries `WHERE ... IS DISTINCT FROM`, so exactly one caller sees a row.
--
-- Money RPCs are deliberately NOT modified here. The agent executors that carry
-- an approver's identity into fn_generate_earning_shares / fn_snapshot_forecast
-- land in their own migration, so this one cannot regress the ledger.
-- =============================================================================

set search_path = public, extensions;

-- 1. Enums --------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'hermes_action_tier') then
    create type public.hermes_action_tier as enum ('automatic', 'approval', 'human_only');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'hermes_approval_state') then
    create type public.hermes_approval_state as enum
      ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired', 'cancelled');
  end if;
end
$$;

-- Worker spend shows up in the same usage view as human chat.
alter type public.ai_request_kind add value if not exists 'agent';

-- 2. hermes_policy — the KV spine ---------------------------------------------
-- Heartbeats, daily cost, telegram offset, job markers, alert throttles and
-- feature kill-switches all live here. It is the single dependency of the loop,
-- the scheduler, the cost cap and the Telegram poller.

create table if not exists public.hermes_policy (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- 3. hermes_approvals — the proposal queue ------------------------------------

create table if not exists public.hermes_approvals (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid,
  job_name         text,
  action_type      text not null,
  tier             public.hermes_action_tier not null,
  state            public.hermes_approval_state not null default 'pending',
  -- `payload` is the exact, replayable argument set for the executor.
  payload          jsonb not null default '{}'::jsonb,
  -- `preview` is what a human reads on the approval card. Never trusted as input.
  preview          jsonb not null default '{}'::jsonb,
  risk_reason      text,
  -- Comes from the policy table, NEVER from the caller: a prompt injection must
  -- not be able to downgrade its own approver.
  required_role    public.user_role not null,
  idempotency_key  text not null unique,
  expires_at       timestamptz,
  decided_by       uuid references public.profiles (id),
  decided_at       timestamptz,
  decided_via      text,
  decision_note    text,
  executed_at      timestamptz,
  execution_result jsonb not null default '{}'::jsonb,
  attempt_count    integer not null default 0,
  last_error       text,
  next_attempt_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint hermes_approvals_required_role_chk
    check (required_role in ('super_admin', 'finance', 'manager'))
);

create index if not exists hermes_approvals_state_idx on public.hermes_approvals (state, required_role);
create index if not exists hermes_approvals_pending_idx on public.hermes_approvals (expires_at) where state = 'pending';
create index if not exists hermes_approvals_claimable_idx
  on public.hermes_approvals (next_attempt_at) where state = 'approved' and executed_at is null;

comment on column public.hermes_approvals.required_role is
  'Set from the TS policy table at enqueue time, never from the agent''s own arguments (015).';

-- 4. Telegram binding ---------------------------------------------------------
-- A chat is only ever accepted once it is verified AND bound to a super_admin.

create table if not exists public.hermes_channels (
  id            uuid primary key default gen_random_uuid(),
  channel_type  text not null default 'telegram',
  external_id   text not null,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  verified      boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (channel_type, external_id)
);

create table if not exists public.hermes_pairing_codes (
  code       text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- 5. Message dedupe + conversation memory -------------------------------------

create table if not exists public.hermes_messages (
  id                  bigint generated always as identity primary key,
  direction           text not null check (direction in ('inbound', 'outbound')),
  channel_type        text not null default 'telegram',
  update_id           bigint,
  msg_type            text,
  body                text,
  external_message_id text,
  created_at          timestamptz not null default now()
);

-- The dedupe key: duplicate Telegram delivery becomes a 23505, not a double turn.
create unique index if not exists hermes_messages_update_uidx
  on public.hermes_messages (channel_type, update_id) where update_id is not null;

create table if not exists public.hermes_sessions (
  id                 uuid primary key default gen_random_uuid(),
  channel_id         uuid not null unique references public.hermes_channels (id) on delete cascade,
  conversation_state jsonb not null default '{}'::jsonb,
  last_inbound_at    timestamptz,
  updated_at         timestamptz not null default now()
);

-- 6. Run + job observability --------------------------------------------------

create table if not exists public.hermes_runs (
  id           uuid primary key default gen_random_uuid(),
  trigger      text,
  job_name     text,
  model        text,
  status       text not null default 'running' check (status in ('running', 'ok', 'failed')),
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  iterations   integer not null default 0,
  cost_usd     numeric(10,6) not null default 0,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists public.hermes_tool_calls (
  id         bigint generated always as identity primary key,
  run_id     uuid references public.hermes_runs (id) on delete cascade,
  tool_name  text not null,
  args       jsonb,
  status     text not null default 'ok' check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);

create table if not exists public.hermes_job_runs (
  id          bigint generated always as identity primary key,
  job_name    text not null,
  status      text not null check (status in ('ok', 'failed', 'skipped')),
  outcome     text,
  error       text,
  duration_ms integer,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists hermes_job_runs_name_idx on public.hermes_job_runs (job_name, started_at desc);

-- 7. RLS — super_admin reads; nobody writes through PostgREST ------------------
-- Writes are service-role only (the worker). Humans never INSERT/UPDATE these
-- tables directly; the one state change a human makes goes through
-- decide_approval(), which is SECURITY DEFINER.

do $$
declare t text;
begin
  foreach t in array array[
    'hermes_policy', 'hermes_approvals', 'hermes_channels', 'hermes_pairing_codes',
    'hermes_messages', 'hermes_sessions', 'hermes_runs', 'hermes_tool_calls',
    'hermes_job_runs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    -- Match the house pattern from 008: AAL2 + active profile is RESTRICTIVE,
    -- so it ANDs with every permissive policy below.
    execute format('drop policy if exists aal2_active_required on public.%I', t);
    execute format(
      'create policy aal2_active_required on public.%I
         as restrictive for all to authenticated
         using ( (select auth.jwt()->>''aal'') = ''aal2'' and public.is_active_profile() )', t);

    execute format('drop policy if exists hermes_sa_select on public.%I', t);
    execute format(
      'create policy hermes_sa_select on public.%I
         for select to authenticated
         using ( public.current_user_role() = ''super_admin'' )', t);
  end loop;
end
$$;

-- 8. Role satisfaction --------------------------------------------------------
-- Deliberately NOT a linear rank. In this system manager and finance are
-- different domains, not a hierarchy — ranking them would let a manager approve
-- a finance action (or vice versa) by accident. Only an exact match, or
-- super_admin, satisfies a requirement.

create or replace function public.hermes_role_satisfies(
  p_actor    public.user_role,
  p_required public.user_role
)
returns boolean
language sql
immutable
as $$
  select p_actor is not null
     and p_required in ('super_admin', 'finance', 'manager')
     and (p_actor = p_required or p_actor = 'super_admin');
$$;

comment on function public.hermes_role_satisfies(public.user_role, public.user_role) is
  'Exact-match-or-super_admin. Not a rank: manager and finance are peer domains (015).';

-- 9. The guard trigger --------------------------------------------------------
-- The service role bypasses RLS but not triggers. Decision states may only be
-- reached from inside decide_approval(), which sets a transaction-local GUC.
-- The worker can still set executed_at / failed / expired — which is exactly why
-- executeApproval's atomic claim is legal.

create or replace function public.hermes_approvals_guard()
returns trigger
language plpgsql
as $$
begin
  if new.state in ('approved', 'rejected')
     and new.state is distinct from old.state
     and coalesce(current_setting('hermes.deciding', true), 'off') <> 'on' then
    raise exception 'hermes_approvals decision states may only be set via decide_approval()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists hermes_approvals_guard_trg on public.hermes_approvals;
create trigger hermes_approvals_guard_trg
  before update on public.hermes_approvals
  for each row execute function public.hermes_approvals_guard();

-- 10. decide_approval — the ONLY door to an approved state --------------------
-- Trust note: p_actor exists so the Telegram callback (service role, no session)
-- can relay a decision a human physically tapped. That path is only reachable
-- from a channel already verified and bound to a super_admin. When a real
-- session exists, auth.uid() ALWAYS wins, so a signed-in user cannot spoof
-- another actor.

create or replace function public.decide_approval(
  p_id      uuid,
  p_verdict text,
  p_actor   uuid default null,
  p_via     text default 'portal',
  p_note    text default null
)
returns public.hermes_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role  public.user_role;
  v_appr  public.hermes_approvals%rowtype;
  v_new   public.hermes_approval_state;
begin
  if p_verdict not in ('approve', 'reject') then
    raise exception 'verdict must be approve or reject' using errcode = '22023';
  end if;

  v_actor := coalesce(auth.uid(), p_actor);
  if v_actor is null then
    raise exception 'no actor for approval decision' using errcode = '42501';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_actor and p.status = 'active';

  if v_role is null then
    raise exception 'actor % is not an active profile', v_actor using errcode = '42501';
  end if;

  select * into v_appr from public.hermes_approvals where id = p_id for update;
  if not found then
    raise exception 'approval % not found', p_id using errcode = 'P0002';
  end if;
  if v_appr.state <> 'pending' then
    raise exception 'approval % is %, not pending', p_id, v_appr.state using errcode = '22023';
  end if;
  if v_appr.expires_at is not null and now() > v_appr.expires_at then
    raise exception 'approval % expired', p_id using errcode = '22023';
  end if;
  if not public.hermes_role_satisfies(v_role, v_appr.required_role) then
    raise exception 'role % may not approve an action requiring %', v_role, v_appr.required_role
      using errcode = '42501';
  end if;

  v_new := case when p_verdict = 'approve' then 'approved' else 'rejected' end;

  -- Open the gate for this statement only.
  perform set_config('hermes.deciding', 'on', true);

  update public.hermes_approvals
     set state         = v_new,
         decided_by    = v_actor,
         decided_at    = now(),
         decided_via   = p_via,
         decision_note = p_note,
         updated_at    = now()
   where id = p_id
   returning * into v_appr;

  perform public.write_audit_as(
    v_actor,
    case when p_verdict = 'approve' then 'hermes.approve' else 'hermes.reject' end,
    'hermes_approval',
    p_id::text,
    jsonb_build_object('action_type', v_appr.action_type, 'via', p_via)
  );

  return v_appr;
end;
$$;

revoke all on function public.decide_approval(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, uuid, text, text) to authenticated, service_role;

-- 11. Audit writer that carries an explicit actor -----------------------------
-- write_audit() reads auth.uid(), which is NULL for the worker. This variant
-- names the human the action is attributed to. audit_log stays append-only —
-- migration 013's trigger refuses UPDATE/DELETE for every role including
-- service_role, so the agent inherits tamper-proof history.

create or replace function public.write_audit_as(
  p_actor       uuid,
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
    p_actor,
    (select p.role from public.profiles p where p.id = p_actor),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_audit_as(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit_as(uuid, text, text, text, jsonb) to service_role;

-- 12. Atomic daily job claim --------------------------------------------------
-- The WHERE on the DO UPDATE is the whole trick: losers update zero rows, so
-- exactly one caller gets true even across concurrent workers.

create or replace function public.hermes_claim_job(p_job text, p_day text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text := 'job_last:' || p_job;
  v_rows integer;
begin
  insert into public.hermes_policy (key, value, description)
  values (v_key, to_jsonb(p_day), 'Last ' || p_job || ' run date (UTC)')
  on conflict (key) do update
    set value = to_jsonb(p_day), updated_at = now()
    where public.hermes_policy.value is distinct from to_jsonb(p_day);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.hermes_claim_job(text, text) from public, anon, authenticated;
grant execute on function public.hermes_claim_job(text, text) to service_role;

-- 13. Atomic cost accumulator -------------------------------------------------

create or replace function public.hermes_incr_policy_number(
  p_key         text,
  p_delta       numeric,
  p_description text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare v_new numeric;
begin
  insert into public.hermes_policy (key, value, description)
  values (p_key, to_jsonb(p_delta), p_description)
  on conflict (key) do update
    set value = to_jsonb(((public.hermes_policy.value)::numeric + p_delta)),
        updated_at = now()
  returning (value)::numeric into v_new;
  return v_new;
end;
$$;

revoke all on function public.hermes_incr_policy_number(text, numeric, text) from public, anon, authenticated;
grant execute on function public.hermes_incr_policy_number(text, numeric, text) to service_role;

-- 14. Seed operational knobs --------------------------------------------------

insert into public.hermes_policy (key, value, description) values
  ('daily_cost_cap_usd', to_jsonb(5.0),  'Hard stop on agent LLM spend per UTC day'),
  ('approval_ttl_hours', to_jsonb(72),   'Pending approvals expire after this many hours; 0 disables'),
  ('agent_enabled',      to_jsonb(true), 'Master kill-switch for all scheduled jobs'),
  ('telegram_enabled',   to_jsonb(true), 'Kill-switch for the Telegram surface'),
  ('max_run_iterations', to_jsonb(8),    'Tool-use loop cap per agent run')
on conflict (key) do nothing;
