-- =============================================================================
-- 005_tables_library.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The Library: an internal back-office file store with AI-assisted
-- categorization. This is a NEW subsystem (settled build decision), deliberately
-- separate from the model compliance documents of docs/06:
--
--   * new table library_files (not `documents`)
--   * new private bucket "library" (not "model-documents")
--   * storage path is FLAT — {file_id}/{filename}; folder_path is a DB column
--     only, so re-filing a document is a metadata UPDATE and never a byte move.
--
-- Access is super_admin + manager only (008); no other role gets a policy at
-- all, so models/finance/operators cannot see the Library exists.
--
-- The classifier runs in a Next.js server route (never an Edge Function) and
-- writes ai_suggested_category_id / ai_confidence / ai_rationale / ai_status,
-- leaving category_id — the authoritative filing — for a human to confirm or
-- override. The ai_review_status enum is defined in 001.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- doc_categories — the classification vocabulary
-- -----------------------------------------------------------------------------
-- `description` is not decoration: it is the text handed to the classifier
-- prompt as the definition of each category, so wording changes here change
-- model behaviour. `ai_enabled = false` marks a category the classifier may
-- never suggest (identity documents are human-filed only).
create table if not exists public.doc_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  ai_enabled  boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on column public.doc_categories.description is
  'Handed verbatim to the Library classifier prompt as the category definition.';
comment on column public.doc_categories.ai_enabled is
  'false = the classifier may never suggest this category; filing is human-only.';

create index if not exists doc_categories_sort_idx on public.doc_categories (sort, name);

-- -----------------------------------------------------------------------------
-- library_files — file metadata + classification state
-- -----------------------------------------------------------------------------
create table if not exists public.library_files (
  id                      uuid primary key default gen_random_uuid(),
  folder_path             text not null default '/',
  name                    text not null,
  mime_type               text,
  size_bytes              bigint,
  storage_path            text not null unique,
  sha256                  text,
  category_id             uuid references public.doc_categories (id) on delete restrict,
  ai_suggested_category_id uuid references public.doc_categories (id),
  ai_confidence           numeric(4,3),
  ai_rationale            text,
  ai_status               public.ai_review_status not null default 'pending',
  ai_exempt               boolean not null default false,
  classified_at           timestamptz,
  classified_provider     public.ai_provider,
  uploaded_by             uuid not null references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint library_files_size_chk       check (size_bytes is null or size_bytes > 0),
  constraint library_files_confidence_chk check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  constraint library_files_folder_chk     check (folder_path like '/%')
);

comment on column public.library_files.storage_path is
  'Flat object key in the private "library" bucket: {file_id}/{filename}. Never encodes folder_path.';
comment on column public.library_files.folder_path is
  'Virtual folder, a DB column only. Re-filing is a metadata update, not a byte move.';
comment on column public.library_files.category_id is
  'Authoritative filing, set by a human (or by confirming a suggestion). ON DELETE RESTRICT: a category in use cannot be deleted.';

create index if not exists library_files_folder_idx   on public.library_files (folder_path);
create index if not exists library_files_pending_idx  on public.library_files (ai_status) where ai_status = 'pending';
create index if not exists library_files_category_idx on public.library_files (category_id);
create index if not exists library_files_suggested_idx on public.library_files (ai_suggested_category_id);
create index if not exists library_files_uploaded_by_idx on public.library_files (uploaded_by);
create index if not exists library_files_created_idx  on public.library_files (created_at desc);
