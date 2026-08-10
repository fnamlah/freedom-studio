-- =============================================================================
-- 010_storage.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- The two private buckets and their storage.objects RLS policies.
--
-- Source of truth: docs/06-documents-sharing.md §2 (bucket, path layout, and the
-- §2.3 policy matrix) plus the settled build decision that the Library gets its
-- own bucket, separate from compliance documents.
--
--   model-documents  path {model_id}/{document_id}/{filename}
--                    SA + MGR : read + write, all objects
--                    MODEL    : SELECT own prefix only — no write, ever
--                    FIN/OPER : none. anon: none.
--
--   library          path {file_id}/{filename}  (FLAT — folder_path is a DB
--                    column only, so re-filing never moves bytes)
--                    SA + MGR : read + write
--                    everyone else: none.
--
-- Both buckets are private. A public bucket would give every object a stable,
-- guessable, unrevocable URL — unacceptable for identity documents. The only two
-- retrieval paths are a 60-second signed URL from an authenticated server action
-- and the share-view Edge Function, which uses the service role and therefore
-- needs no anon grant at all.
--
-- storage.objects has no equivalent of the per-table restrictive policy created
-- in 008, so the AAL2 + active-profile precondition is spelled out inside EVERY
-- policy below via is_aal2() and is_active_profile(). Leaving either conjunct
-- out of any one policy would open a storage path to an AAL1 session.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Buckets
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('model-documents', 'model-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- model-documents
-- -----------------------------------------------------------------------------
drop policy if exists model_documents_admin_all on storage.objects;
create policy model_documents_admin_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'model-documents'
    and public.is_aal2()
    and public.is_active_profile()
    and public.current_user_role() in ('super_admin', 'manager')
  )
  with check (
    bucket_id = 'model-documents'
    and public.is_aal2()
    and public.is_active_profile()
    and public.current_user_role() in ('super_admin', 'manager')
  );

-- The first path segment is the RLS scoping key: a single-segment comparison,
-- no join. SELECT only — models can never upload or delete.
drop policy if exists model_documents_model_read_own on storage.objects;
create policy model_documents_model_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'model-documents'
    and public.is_aal2()
    and public.is_active_profile()
    and public.current_user_role() = 'model'
    and (storage.foldername(name))[1] = public.my_model_id()::text
  );

-- Finance, operators and anon get no policy at all on this bucket: deny by
-- absence, mirroring the documents-table matrix in 008.

-- -----------------------------------------------------------------------------
-- library
-- -----------------------------------------------------------------------------
drop policy if exists library_admin_all on storage.objects;
create policy library_admin_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'library'
    and public.is_aal2()
    and public.is_active_profile()
    and public.current_user_role() in ('super_admin', 'manager')
  )
  with check (
    bucket_id = 'library'
    and public.is_aal2()
    and public.is_active_profile()
    and public.current_user_role() in ('super_admin', 'manager')
  );
