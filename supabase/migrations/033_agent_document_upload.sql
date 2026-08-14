-- =============================================================================
-- 033 — Documents arrive by Telegram
-- -----------------------------------------------------------------------------
-- Until now documents entered only through the portal's upload form; the bot
-- could read, retitle, consent-read and (032) delete them, but not ADD one.
-- Alina photographs a passport, sends it to the chat with "паспорт Лены", the
-- bot proposes, she taps Approve — and the executor downloads the file from
-- Telegram, stores it in the private bucket, and calls this to write the row.
--
-- Same shape as every 029-032 wrapper: verify the approver's role (SA/MGR —
-- exactly who 008's documents_admin_all lets upload in the portal), impersonate
-- for the transaction, insert with the HUMAN as uploaded_by.
--
-- The row is written AFTER the storage object exists (the executor's order):
-- `storage_path` is NOT NULL UNIQUE, and a row pointing at nothing would be a
-- document the portal shows but cannot open. The reverse — an object without a
-- row — is invisible garbage a retry can reclaim, which is the right failure.
-- =============================================================================

set search_path = public, extensions;

create or replace function public.fn_agent_create_document(
  p_approver     uuid,
  p_model_id     uuid,
  p_doc_type     public.document_type,
  p_title        text,
  p_storage_path text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_sha256       text default null,
  p_issued_date  date default null,
  p_expires_at   date default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_id   uuid;
begin
  v_role := public.fn_agent_approver_role(p_approver, array['super_admin','manager']::public.user_role[]);
  perform public.fn_agent_impersonate(p_approver, v_role);

  if not exists (select 1 from public.models m where m.id = p_model_id) then
    raise exception 'model % not found', p_model_id using errcode = '23503';
  end if;

  -- A retry after a crash between the row insert and the executor's marker
  -- finds the row by its unique storage_path and returns it instead of dying
  -- on 23505 — the same idempotency stance as every other wrapper.
  select d.id into v_id from public.documents d where d.storage_path = p_storage_path;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.documents (
    model_id, doc_type, title, storage_path, file_name, mime_type,
    file_size_bytes, sha256, issued_date, expires_at, uploaded_by
  )
  values (
    p_model_id, p_doc_type, p_title, p_storage_path, p_file_name, p_mime_type,
    p_size_bytes, p_sha256, p_issued_date, p_expires_at, p_approver
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fn_agent_create_document(uuid, uuid, public.document_type, text, text, text, text, bigint, text, date, date) from public, anon, authenticated;
grant execute on function public.fn_agent_create_document(uuid, uuid, public.document_type, text, text, text, text, bigint, text, date, date) to service_role;

comment on function public.fn_agent_create_document(uuid, uuid, public.document_type, text, text, text, text, bigint, text, date, date) is
  'Writes a compliance document row on behalf of an approving super_admin/manager, after the executor stored the file (033). Idempotent on storage_path so a crashed executor retry returns the existing row.';
