-- =============================================================================
-- 021 — Document analyzer: proposed records from uploaded files
-- -----------------------------------------------------------------------------
-- Studio staff re-type what is already written in the files they upload:
-- a platform payout statement becomes `earnings` rows, a shift export becomes
-- `work_sessions`, an ID or contract becomes `documents` metadata.
--
-- The AI already reads these files — `classifyFile` (Library) and
-- `analyseDocument` (Documents) — but their answer stops at a summary and key
-- figures. This migration adds the staging table that lets that same crossing
-- also propose ROWS, which a human then reviews and applies.
--
-- Deliberately a proposal, never a write: nothing here touches `earnings`,
-- `work_sessions` or `documents`. The apply step runs in the app under the
-- caller's own RLS, through the SAME zod schemas the manual forms use, so an
-- AI-proposed row cannot bypass a rule a typed row obeys.
--
-- Shape borrowed from `hermes_approvals` (015), which solved the same problem
-- for the agent: payload is the replayable argument set, preview is what a
-- human reads, and the state machine is explicit.
-- =============================================================================

set search_path = public, extensions;

-- A new metering kind so extraction spend is separable from classification in
-- `ai_usage`. (The TS union in src/lib/ai/budget.ts is hand-maintained and must
-- be kept in step — 015 added 'agent' there and the union was missed.)
alter type public.ai_request_kind add value if not exists 'extract';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'doc_extraction_kind') then
    create type public.doc_extraction_kind as enum (
      'earnings',       -- platform payout statement  → earnings rows
      'sessions',       -- shift / work report        → work_sessions rows
      'expenses',       -- receipt / invoice          → expenses rows
      'document_meta'   -- ID / contract              → fills the documents row
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'doc_extraction_state') then
    create type public.doc_extraction_state as enum (
      'proposed',   -- waiting for a human
      'applied',    -- rows created
      'dismissed',  -- human said no
      'failed'      -- apply raised; last_error explains
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'doc_source_kind') then
    create type public.doc_source_kind as enum ('library_file', 'document');
  end if;
end $$;

create table if not exists public.doc_extractions (
  id            uuid primary key default gen_random_uuid(),
  source_kind   public.doc_source_kind    not null,
  -- No FK: the source is one of two tables. Deleting the file leaves the
  -- proposal orphaned rather than cascading a delete into a review queue.
  source_id     uuid                      not null,
  kind          public.doc_extraction_kind not null,
  state         public.doc_extraction_state not null default 'proposed',

  -- What the model proposed. Validated at APPLY time by the same zod schema the
  -- manual form uses — never trusted on the way in.
  payload       jsonb                     not null,
  -- 0..1, the model's own confidence. Advisory only: it gates nothing.
  confidence    numeric(4,3),
  provider      public.ai_provider,
  model         text,

  created_at    timestamptz               not null default now(),
  created_by    uuid                      references public.profiles (id),
  reviewed_by   uuid                      references public.profiles (id),
  reviewed_at   timestamptz,
  -- What actually happened on apply: ids created, rows skipped as duplicates.
  result        jsonb,
  last_error    text,

  constraint doc_extractions_confidence_chk
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- One live proposal per (source, kind): re-running the analyser on the same
  -- file must not stack duplicates in the queue.
  constraint doc_extractions_unique unique (source_kind, source_id, kind)
);

create index if not exists doc_extractions_state_idx
  on public.doc_extractions (state, created_at desc);
create index if not exists doc_extractions_source_idx
  on public.doc_extractions (source_kind, source_id);

comment on table public.doc_extractions is
  'Records an uploaded document proposes. Reviewed by a human, then applied through the same validation the manual forms use (021).';

-- -----------------------------------------------------------------------------
-- expenses — studio costs
-- -----------------------------------------------------------------------------
-- NOT a ledger entry. `ledger_entries` requires a payee_type/payee_id of a
-- model or operator, and studio rent has neither. Kept out of the ledger and
-- out of the payout maths on purpose: this is a record of spend, not a credit
-- or debit against anyone's balance.
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  incurred_on   date        not null,
  vendor        text        not null,
  description   text,
  amount        numeric(12,2) not null check (amount > 0),
  currency      char(3)     not null default 'USD',
  category      text,
  -- The receipt this came from, when it came from one.
  library_file_id uuid      references public.library_files (id) on delete set null,
  source        public.entry_source not null default 'manual',
  created_by    uuid        not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists expenses_incurred_idx on public.expenses (incurred_on desc);
create index if not exists expenses_vendor_idx   on public.expenses (vendor);

comment on table public.expenses is
  'Studio operating costs. Deliberately outside ledger_entries, which is payee-scoped, and outside the payout calculation (021).';

-- -----------------------------------------------------------------------------
-- RLS — same reach as the surfaces these rows are derived from (SA + MGR),
-- with the AAL2 + active-profile restrictive policy every table carries.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['doc_extractions', 'expenses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists aal2_active_required on public.%I', t);
    execute format(
      'create policy aal2_active_required on public.%I
         as restrictive for all to authenticated
         using ( (select auth.jwt()->>''aal'') = ''aal2'' and public.is_active_profile() )', t);
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format(
      'create policy %I_admin_all on public.%I
         for all to authenticated
         using (public.current_user_role() in (''super_admin'', ''manager''))
         with check (public.current_user_role() in (''super_admin'', ''manager''))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop trigger if exists set_updated_at on public.expenses;
create trigger set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
