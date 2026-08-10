-- =============================================================================
-- 006_functions_helpers.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The small, auditable primitives every RLS policy composes.
--
-- Source of truth: docs/04-database-erd.md §6.
--
-- All are SECURITY DEFINER, STABLE, SET search_path = ''. The definer
-- escalation is limited to reading the caller's own profiles/models/operators
-- linkage; the emptied search path blocks object-shadowing attacks. Because
-- they are DEFINER they do not re-enter RLS, which is what keeps policies on
-- `profiles` from recursing into themselves.
--
-- Per docs/07 §1 these helpers (plus the share-token validation path of docs/06)
-- are the ONLY SECURITY DEFINER functions in the system, with two additions
-- this migration set is explicit about:
--   * profile_fields_unchanged() below — needed because an RLS WITH CHECK
--     cannot see the OLD row, and a self-referencing subquery on `profiles`
--     inside a `profiles` policy recurses. See its comment.
--   * the audit/validation trigger functions in 007, which must write
--     append-only tables no role holds INSERT on.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- is_aal2() — true only for a TOTP-verified session
-- -----------------------------------------------------------------------------
create or replace function public.is_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false);
$$;

comment on function public.is_aal2() is
  'AAL2 assurance check (docs/05 §5). Used directly by the storage.objects policies in 010; table policies use the canonical restrictive snippet.';

-- -----------------------------------------------------------------------------
-- is_active_profile() — catches deactivated users whose JWT has not yet expired
-- -----------------------------------------------------------------------------
create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
  );
$$;

comment on function public.is_active_profile() is
  'Closes the JWT-staleness window: a deactivated user with a still-valid token reads zero rows (docs/03 §2.1, docs/05 §6).';

-- -----------------------------------------------------------------------------
-- current_user_role() — JWT claim first, profiles fallback
-- -----------------------------------------------------------------------------
-- The claim is injected by the Custom Access Token Auth Hook (docs/03 §2.1).
-- The claim value is matched against the known enum labels before casting, so a
-- malformed or unexpected claim degrades to the database fallback instead of
-- raising inside a policy evaluation.
create or replace function public.current_user_role()
returns public.user_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim text;
begin
  v_claim := nullif(auth.jwt() ->> 'user_role', '');

  if v_claim in ('super_admin', 'manager', 'model', 'finance', 'operator') then
    return v_claim::public.user_role;
  end if;

  return (select p.role from public.profiles p where p.id = auth.uid());
end;
$$;

comment on function public.current_user_role() is
  'Reads the user_role JWT claim when present, else profiles.role. Every permissive policy in 008 keys off this (no JWT-hook dependency).';

-- -----------------------------------------------------------------------------
-- my_model_id() / my_operator_id() — own-row scoping keys
-- -----------------------------------------------------------------------------
create or replace function public.my_model_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.models m where m.profile_id = auth.uid();
$$;

create or replace function public.my_operator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.operators o where o.profile_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- profile_fields_unchanged() — privilege-escalation guard for profiles UPDATE
-- -----------------------------------------------------------------------------
-- An RLS WITH CHECK expression sees only the NEW row. To assert "this update did
-- not change role or status" the policy must compare against the stored row —
-- and a subquery on `profiles` inside a `profiles` policy triggers
-- "infinite recursion detected in policy for relation profiles". A SECURITY
-- DEFINER lookup sidesteps both problems: it does not re-enter RLS, and because
-- it is STABLE it observes the statement snapshot, i.e. the pre-UPDATE row.
--
-- Returns true when the proposed role/status equal the stored ones. Used by the
-- manager and self-service UPDATE policies in 008; the super_admin policy does
-- not use it, and role/status changes remain a guarded service-role server path
-- (docs/03 §2.1, docs/05 §7, docs/08 privilege-escalation row).
create or replace function public.profile_fields_unchanged(
  p_id     uuid,
  p_role   public.user_role,
  p_status public.user_status
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_id
      and p.role = p_role
      and p.status = p_status
  );
$$;

comment on function public.profile_fields_unchanged(uuid, public.user_role, public.user_status) is
  'True when the proposed role/status match the stored row. Lets a WITH CHECK forbid role/status edits without recursing into the profiles policies.';

-- -----------------------------------------------------------------------------
-- Execution grants
-- -----------------------------------------------------------------------------
-- Policy expressions are evaluated as the querying role, so `authenticated`
-- needs EXECUTE. `anon` holds no grant of any kind anywhere in this schema.
revoke all on function public.is_aal2()              from public, anon;
revoke all on function public.is_active_profile()    from public, anon;
revoke all on function public.current_user_role()    from public, anon;
revoke all on function public.my_model_id()          from public, anon;
revoke all on function public.my_operator_id()       from public, anon;
revoke all on function public.profile_fields_unchanged(uuid, public.user_role, public.user_status) from public, anon;

grant execute on function public.is_aal2()           to authenticated, service_role;
grant execute on function public.is_active_profile() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.my_model_id()       to authenticated, service_role;
grant execute on function public.my_operator_id()    to authenticated, service_role;
grant execute on function public.profile_fields_unchanged(uuid, public.user_role, public.user_status)
  to authenticated, service_role;
