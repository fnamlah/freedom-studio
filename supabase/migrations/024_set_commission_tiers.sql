-- =============================================================================
-- 024 — Setting a scheme's tier ladder, atomically
-- -----------------------------------------------------------------------------
-- The tier UI edits a LADDER, not a row: adding a rung, moving a threshold and
-- deleting a rung all happen in one save. Done over PostgREST that is a DELETE
-- followed by an INSERT — two round-trips, no transaction between them. If the
-- second one fails, the scheme silently loses its tiers and every subsequent
-- close prices at the base rate. Nothing errors; the money is just quietly
-- wrong. So the replace happens inside one function body, which is one
-- transaction.
--
-- SECURITY INVOKER, deliberately: RLS stays the final authority. The policies
-- from 023 (super_admin writes) are what actually permit this, exactly as they
-- would for a direct DELETE/INSERT. The role check below is a friendlier error,
-- not the gate.
--
-- `p_tiers` is the whole ladder as jsonb:
--   [{"min_amount": 1000, "model_percent": 65,
--     "operator_percent": 10, "studio_percent": 25}, ...]
-- An empty array clears the ladder and returns the scheme to its base rates.
-- =============================================================================

set search_path = public, extensions;

create or replace function public.fn_set_commission_tiers(
  p_scheme_id uuid,
  p_tiers     jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_role  public.user_role := public.current_user_role();
  v_actor uuid             := auth.uid();
  v_count integer;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'fn_set_commission_tiers is restricted to super_admin'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_tiers) <> 'array' then
    raise exception 'p_tiers must be a json array' using errcode = '22023';
  end if;

  -- Fails loudly rather than silently writing nothing for a bad id.
  if not exists (select 1 from public.commission_schemes cs where cs.id = p_scheme_id) then
    raise exception 'commission scheme % not found', p_scheme_id using errcode = '23503';
  end if;

  delete from public.commission_tiers ct where ct.scheme_id = p_scheme_id;

  insert into public.commission_tiers (
    scheme_id, min_amount, model_percent, operator_percent, studio_percent, created_by
  )
  select
    p_scheme_id,
    (t->>'min_amount')::numeric,
    (t->>'model_percent')::numeric,
    (t->>'operator_percent')::numeric,
    (t->>'studio_percent')::numeric,
    v_actor
  from jsonb_array_elements(p_tiers) as t;

  get diagnostics v_count = row_count;

  -- Every CHECK and the unique (scheme_id, min_amount) constraint from 023 fire
  -- on the INSERT above; a bad ladder aborts the whole call, leaving the
  -- existing tiers in place. That is the point of doing it in one statement
  -- block rather than two requests.
  return v_count;
end;
$$;

comment on function public.fn_set_commission_tiers(uuid, jsonb) is
  'Replaces a scheme''s entire tier ladder in one transaction. Empty array clears it, returning the scheme to its base percentages (024).';

revoke all on function public.fn_set_commission_tiers(uuid, jsonb) from public, anon;
grant execute on function public.fn_set_commission_tiers(uuid, jsonb) to authenticated;
