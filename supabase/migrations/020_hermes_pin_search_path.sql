-- =============================================================================
-- 020 — pin `search_path` on the two functions migration 015 left mutable
-- -----------------------------------------------------------------------------
-- Supabase's linter flagged both. Neither is SECURITY DEFINER, so this is
-- hardening rather than a live hole — but an unpinned `search_path` lets the
-- caller decide which schema the function's unqualified names resolve to, and
-- `hermes_approvals_guard` is precisely the trigger that stops the service role
-- approving its own proposals. That is not a function whose name resolution
-- should depend on who invoked it.
--
-- Every other function in this schema already sets this; 015 simply missed it.
-- Verified after applying: a direct service-role UPDATE to 'approved' is still
-- refused with 42501.
-- =============================================================================

alter function public.hermes_role_satisfies(public.user_role, public.user_role)
  set search_path = '';

alter function public.hermes_approvals_guard()
  set search_path = '';
