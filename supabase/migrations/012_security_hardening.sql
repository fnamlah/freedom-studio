-- =============================================================================
-- 012_security_hardening.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- Locks down EXECUTE on SECURITY DEFINER functions so they are not needlessly
-- reachable as PostgREST RPCs (/rest/v1/rpc/<fn>). Addresses Supabase database
-- linter findings 0028 (anon-executable) and 0029 (authenticated-executable).
--
-- Two classes of function:
--   1. Trigger / validation functions — only ever invoked by a trigger, which
--      fires the function regardless of EXECUTE grants. They need NO grant to
--      anyone; revoke from PUBLIC (and explicitly from anon/authenticated) so
--      they disappear from the API surface entirely.
--   2. RLS helper functions — evaluated inside RLS policy expressions, which
--      run as the querying role, so `authenticated` genuinely needs EXECUTE.
--      We revoke the default PUBLIC grant (which would otherwise include anon)
--      and re-grant ONLY to authenticated. These remain visible to the linter
--      as 0029 by design: they expose only the caller's OWN session facts
--      (own role, own model/operator id, own AAL/active status).
--
-- Safe to re-run.
-- =============================================================================

-- 1. Trigger / validation functions: no role needs EXECUTE.
do $$
declare
  fn text;
  trigger_fns text[] := array[
    'public.handle_new_user()',
    'public.check_operator_pool()',
    'public.enforce_payout_transition()',
    'public.payout_paid_settlement()',
    'public.validate_ledger_payee()',
    'public.validate_payout_payee()',
    'public.tg_audit_ai_reports()',
    'public.tg_audit_app_settings()',
    'public.tg_audit_commission_schemes()',
    'public.tg_audit_document_shares()',
    'public.tg_audit_documents()',
    'public.tg_audit_invitations()',
    'public.tg_audit_ledger_entries()',
    'public.tg_audit_library_files()',
    'public.tg_audit_payouts()',
    'public.tg_audit_profiles()'
  ];
begin
  foreach fn in array trigger_fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public', fn);
      execute format('revoke all on function %s from anon', fn);
      execute format('revoke all on function %s from authenticated', fn);
    end if;
  end loop;
end
$$;

-- 2. RLS helper functions: revoke PUBLIC (removes anon), keep only authenticated.
do $$
declare
  fn text;
  helper_fns text[] := array[
    'public.is_aal2()',
    'public.is_active_profile()',
    'public.current_user_role()',
    'public.my_model_id()',
    'public.my_operator_id()',
    'public.profile_fields_unchanged(uuid, public.user_role, public.user_status)'
  ];
begin
  foreach fn in array helper_fns loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public', fn);
      execute format('revoke all on function %s from anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
    end if;
  end loop;
end
$$;
