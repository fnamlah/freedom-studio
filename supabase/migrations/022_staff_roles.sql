-- =============================================================================
-- 022 — Studio groups: model (constant) + a variable team
-- -----------------------------------------------------------------------------
-- Every group in the studio has exactly one model. Around that model the cast
-- varies: sometimes nobody, sometimes an operator, sometimes an operator plus a
-- coach plus a team leader. Alina needs to set that up per model without anyone
-- touching a commission scheme.
--
-- THE MONEY MATH ALREADY DOES THIS. `commission_schemes.operator_percent` is a
-- POOL, not one person's cut, and `fn_generate_earning_shares` divides it among
-- whoever is assigned to the model for that period, weighted by
-- `operator_assignments.pool_share_percent` (docs/09 §4.3). A model with no
-- assignments leaves the whole pool with the studio; a model with three helpers
-- splits it three ways. So:
--
--   model only                    → no assignments; pool falls to the studio
--   model + operator              → one assignment at 100% of the pool
--   model + operator + coach + TL → three assignments summing to 100%
--
-- None of that changes here. The only thing missing was that every helper was
-- called an "operator". This migration adds WHAT KIND of team member each one
-- is, so the same pool can be shared by different kinds of people.
--
-- Deliberately NOT changed:
--   * `payee_type` stays ('model','operator'). It discriminates "is this the
--     performer or someone on the team", which is what the ledger, payouts and
--     balances need. A coach is paid through the same mechanism as an operator;
--     only the label differs, and the label comes from `staff_role`.
--   * `user_role` is untouched. A coach who needs a login gets the existing
--     `operator` role and sees their own balance, which is already correct.
--   * `fn_generate_earning_shares` is untouched — no money logic changes.
-- =============================================================================

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_role') then
    create type public.staff_role as enum ('operator', 'coach', 'team_leader');
  end if;
end $$;

alter table public.operators
  add column if not exists staff_role public.staff_role not null default 'operator';

comment on column public.operators.staff_role is
  'What kind of team member this is: operator, coach or team leader. Payment is identical for all three — they share the commission scheme''s team pool, weighted per assignment (022).';

comment on table public.operators is
  'Non-performer members of a studio group: operators, coaches and team leaders. The model is the constant in a group; these are the variables (022).';

comment on column public.commission_schemes.operator_percent is
  'The TEAM pool: the share of net earnings divided among everyone assigned to the model for the period, weighted by operator_assignments.pool_share_percent. Unassigned remainder falls to the studio (022).';

create index if not exists operators_staff_role_idx on public.operators (staff_role);
