-- =============================================================================
-- 014 — AI document analysis: summaries, key figures, and the compliance
--        opt-in that extends the carve-out beyond the library bucket
-- -----------------------------------------------------------------------------
-- Two changes, one of which moves a security boundary and is therefore spelled
-- out in full:
--
-- 1. ANALYSIS OUTPUT. Classification previously produced only a category
--    suggestion. Both surfaces now also carry a short summary and extracted key
--    figures, so a human reviewing the queue sees what a document SAYS, not just
--    where it was filed.
--
-- 2. COMPLIANCE OPT-IN (owner decision, 2026-08-12). docs/12 §6 previously
--    scoped the classification channel to the `library` bucket, with compliance
--    documents unreachable "by any path". The owner has chosen to allow AI
--    analysis of compliance documents too. The boundary is not simply removed —
--    it is replaced by an explicit, per-document, default-OFF consent flag:
--
--      * `documents.ai_analysis_opt_in` defaults to FALSE. A document that has
--        never been opted in cannot cross, and the channel refuses it.
--      * Only super_admin and manager can set the flag (the RLS policy on
--        `documents` already restricts writes to those roles).
--      * Turning it back off is honoured immediately: the channel reads the
--        flag at crossing time, not at upload time.
--      * Every crossing is audited (`ai.analyse`) and metered (`ai_usage`) by
--        the caller exactly as library classification always has been.
--
--    These documents contain third parties' identity data (legal names, dates
--    of birth, government ID numbers). The flag is the record of a deliberate
--    decision to send a specific document to a third-party processor.
-- =============================================================================

set search_path = public, extensions;

-- 1. Library: analysis output ------------------------------------------------
alter table public.library_files
  add column if not exists ai_summary     text,
  add column if not exists ai_key_figures jsonb;

comment on column public.library_files.ai_summary is
  'Short plain-language summary produced by the analyser (014). Null until analysed.';
comment on column public.library_files.ai_key_figures is
  'Extracted key/value facts (totals, dates, counterparties) as a JSON array of {label, value} (014).';

-- 2. Compliance documents: opt-in + analysis output --------------------------
alter table public.documents
  add column if not exists ai_analysis_opt_in boolean not null default false,
  add column if not exists ai_status          public.ai_review_status not null default 'pending',
  add column if not exists ai_summary         text,
  add column if not exists ai_key_figures     jsonb,
  add column if not exists analysed_at        timestamptz,
  add column if not exists analysed_provider  public.ai_provider;

comment on column public.documents.ai_analysis_opt_in is
  'Per-document consent to send this compliance document''s contents to an external AI provider. '
  'Defaults FALSE; read at crossing time so revoking it takes effect immediately (docs/12 §6, 014).';
comment on column public.documents.ai_status is
  'pending | suggested | confirmed | overridden | skipped | failed — mirrors library_files (014).';

-- Analysed documents must record which processor saw them: an opted-in
-- document that has been analysed always names its provider, so the audit
-- question "who has seen this passport" is answerable from the row itself.
alter table public.documents
  drop constraint if exists documents_analysed_provenance_chk;
alter table public.documents
  add constraint documents_analysed_provenance_chk
  check (analysed_at is null or analysed_provider is not null);

create index if not exists documents_ai_status_idx
  on public.documents (ai_status)
  where ai_analysis_opt_in;
