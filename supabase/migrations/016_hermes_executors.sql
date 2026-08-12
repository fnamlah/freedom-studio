-- =============================================================================
-- 016 — Hermes executors: carrying an approver's identity into the write RPCs
-- -----------------------------------------------------------------------------
-- `fn_generate_earning_shares` and `fn_snapshot_forecast` are SECURITY INVOKER
-- and gate on `current_user_role()`, which reads the JWT and falls back to
-- `auth.uid()`. The worker has neither, so it is rejected with 42501 — correctly.
--
-- Rather than duplicate a money-critical function (two implementations of the
-- commission split is exactly the drift you cannot afford), these wrappers set
-- the request claims FOR THE TRANSACTION ONLY to the human who approved the
-- action, then call the existing function unchanged. The ledger rows are
-- therefore attributed to that human, and the scheme-resolution logic has
-- exactly one implementation.
--
-- Why this is not a privilege-escalation hole:
--   * Granted to service_role ONLY; revoked from anon and authenticated, so no
--     browser session can reach them.
--   * The approver's role and active status are re-checked here, against
--     `profiles`, at execution time.
--   * They are only ever called by executeApproval, which itself only runs on a
--     row that reached 'approved' through decide_approval — a state the service
--     role cannot set (015 guard trigger).
--   * set_config(..., true) is transaction-local; it cannot leak to another
--     statement or session.
-- =============================================================================

set search_path = public, extensions;

create or replace function public.fn_agent_generate_earning_shares(
  p_period_start date,
  p_period_end   date,
  p_approver     uuid
)
returns table (posted_count integer, skipped_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = p_approver and p.status = 'active';

  if v_role is null or v_role not in ('super_admin', 'finance') then
    raise exception 'approver % may not close periods', p_approver using errcode = '42501';
  end if;

  -- Transaction-local impersonation of the approving human.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_approver::text, 'user_role', v_role::text)::text,
    true
  );

  return query
    select * from public.fn_generate_earning_shares(p_period_start, p_period_end);
end;
$$;

revoke all on function public.fn_agent_generate_earning_shares(date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_agent_generate_earning_shares(date, date, uuid)
  to service_role;

comment on function public.fn_agent_generate_earning_shares(date, date, uuid) is
  'Agent executor for period close. Re-verifies the approver, impersonates them '
  'for the transaction, and delegates to the unchanged INVOKER function (016).';

create or replace function public.fn_agent_snapshot_forecast(
  p_months_ahead integer,
  p_approver     uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_rows integer;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = p_approver and p.status = 'active';

  if v_role is null or v_role not in ('super_admin', 'finance') then
    raise exception 'approver % may not snapshot forecasts', p_approver using errcode = '42501';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_approver::text, 'user_role', v_role::text)::text,
    true
  );

  select public.fn_snapshot_forecast(p_months_ahead) into v_rows;
  return v_rows;
end;
$$;

revoke all on function public.fn_agent_snapshot_forecast(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_agent_snapshot_forecast(integer, uuid)
  to service_role;
