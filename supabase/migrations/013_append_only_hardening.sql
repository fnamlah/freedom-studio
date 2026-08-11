-- =============================================================================
-- 013 — Append-only hardening for audit_log and ledger_entries
-- -----------------------------------------------------------------------------
-- Until now append-only was enforced by the ABSENCE of UPDATE/DELETE RLS
-- policies (008 §12) — airtight for `authenticated`, but the service role
-- carries BYPASSRLS and full table grants, so the server-only key could still
-- mutate history through PostgREST (found by the E2E append-only probe).
--
-- These statement-level triggers refuse UPDATE and DELETE for EVERY role —
-- service_role included; only a superuser could disable them. Nothing
-- legitimate is affected: both tables are insert-only by design (corrections
-- are reversing ledger entries; audit rows are never revised), and no code
-- path in the app, the Edge Functions, or the migrations updates or deletes
-- either table.
-- =============================================================================

set search_path = public, extensions;

create or replace function public.fn_refuse_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed (corrections are reversing inserts)',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

comment on function public.fn_refuse_append_only_mutation() is
  'Statement-level refusal of UPDATE/DELETE on append-only tables. Binds every role including service_role (013).';

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each statement execute function public.fn_refuse_append_only_mutation();

drop trigger if exists ledger_entries_append_only on public.ledger_entries;
create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each statement execute function public.fn_refuse_append_only_mutation();
