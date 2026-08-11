-- =============================================================================
-- 001_extensions_enums.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- Extensions and every product-defined enum.
--
-- Source of truth: docs/04-database-erd.md §1 (required extensions) and §2 (enum
-- catalogue), plus the build decision adding `ai_review_status` for the Library
-- classifier workflow.
--
-- Conventions applied here and in every later migration:
--   * Extensions live in the `extensions` schema (Supabase convention; keeps the
--     `public` schema clean and avoids the "extension in public" advisor).
--     Consequently `citext` and `vector` are always referenced schema-qualified
--     (`extensions.citext`, `extensions.vector`).
--   * Enums are product-defined and closed-world; users can never create values.
--     Adding one is a deliberate migration (docs/03-roles-rbac.md §2).
--   * Everything is written to be re-runnable against a partially applied DB,
--     while assuming a fresh Postgres 17 Supabase project on first apply.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create schema if not exists extensions;

-- citext: case-insensitive e-mail columns (profiles.email, invitations.email).
create extension if not exists citext with schema extensions;

-- btree_gist: lets GiST exclusion constraints mix equality on scalar columns
-- with range overlap (operator_assignments, commission_schemes).
create extension if not exists btree_gist with schema extensions;

-- vector (pgvector): embeddings.embedding + its ANN index (docs/11-ai-llm.md §6).
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums (docs/04-database-erd.md §2)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'user_role') then
    create type public.user_role as enum ('super_admin', 'manager', 'model', 'finance', 'operator');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'user_status') then
    create type public.user_status as enum ('invited', 'active', 'deactivated');
  end if;

  -- Deliberately reused for operators: the lifecycle is identical (04 §2).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'model_status') then
    create type public.model_status as enum ('active', 'inactive', 'on_leave', 'terminated');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'account_status') then
    create type public.account_status as enum ('active', 'suspended', 'closed');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'payout_status') then
    create type public.payout_status as enum ('pending', 'approved', 'paid', 'cancelled');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'document_type') then
    create type public.document_type as enum (
      'government_id', 'passport', 'contract', 'model_release',
      'consent_form', 'tax_form', 'other');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'invitation_status') then
    create type public.invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'entry_source') then
    create type public.entry_source as enum ('manual', 'import');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'payee_type') then
    create type public.payee_type as enum ('model', 'operator');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'ledger_entry_type') then
    create type public.ledger_entry_type as enum (
      'earning_share', 'adjustment', 'deduction', 'payout_settlement');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'ai_provider') then
    create type public.ai_provider as enum ('moonshot', 'zhipu');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'ai_message_role') then
    create type public.ai_message_role as enum ('user', 'assistant', 'tool');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'ai_request_kind') then
    create type public.ai_request_kind as enum ('chat', 'embedding', 'report', 'classify');
  end if;

  -- Document *contents* are never an embedding source (docs/11-ai-llm.md §6.1).
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'embedding_source') then
    create type public.embedding_source as enum (
      'model_note', 'operator_note', 'platform', 'document_meta');
  end if;

  -- Library classifier review lifecycle (build decision; not in docs/04).
  --   pending    — not yet classified
  --   suggested  — the model proposed a category, awaiting human review
  --   confirmed  — a human accepted the suggestion
  --   overridden — a human chose a different category
  --   skipped    — deliberately excluded from classification (ai_exempt files)
  --   failed     — the classification run errored
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'ai_review_status') then
    create type public.ai_review_status as enum (
      'pending', 'suggested', 'confirmed', 'overridden', 'skipped', 'failed');
  end if;
end
$$;
