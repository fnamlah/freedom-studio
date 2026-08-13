-- =============================================================================
-- 030 — Models, and consent to read a compliance document
-- -----------------------------------------------------------------------------
-- The two wrappers 029 did not cover, completing the set the owner asked for.
--
-- ⚠ This file was applied to the database before it existed in the repo — an
-- adversarial review caught that the source was missing, which would have left
-- a fresh environment silently without these functions while production had
-- them. Recorded here so the two agree.
--
-- Both follow 029's shape: verify the APPROVER's role server-side, set the
-- claims to that person, write. And the same caveat applies — these are
-- SECURITY DEFINER functions owned by the table owner, so RLS is not evaluated
-- inside them; the gate is the explicit role check plus the approval that had
-- to happen first.
-- =============================================================================

set search_path = public, extensions;

-- Create or update a model. `p_model_id` null = create. On an update only the
-- supplied fields change, so omission never blanks a column.
create or replace function public.fn_agent_upsert_model(
  p_approver          uuid,
  p_model_id          uuid default null,
  p_stage_name        text default null,
  p_legal_name        text default null,
  p_date_of_birth     date default null,
  p_commission_percent numeric default null,
  p_status            public.model_status default null,
  p_email             text default null,
  p_phone             text default null,
  p_country           text default null
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

  if p_model_id is null then
    if p_stage_name is null or p_legal_name is null or p_date_of_birth is null then
      raise exception 'a new model needs a stage name, legal name and date of birth'
        using errcode = '23502';
    end if;
    insert into public.models (
      stage_name, legal_name, date_of_birth, commission_percent,
      status, email, phone, country, created_by
    )
    values (
      p_stage_name, p_legal_name, p_date_of_birth, coalesce(p_commission_percent, 60),
      coalesce(p_status, 'active'), p_email, p_phone, p_country, p_approver
    )
    returning id into v_id;
  else
    update public.models m
       set stage_name         = coalesce(p_stage_name, m.stage_name),
           legal_name         = coalesce(p_legal_name, m.legal_name),
           date_of_birth      = coalesce(p_date_of_birth, m.date_of_birth),
           commission_percent = coalesce(p_commission_percent, m.commission_percent),
           status             = coalesce(p_status, m.status),
           email              = coalesce(p_email, m.email),
           phone              = coalesce(p_phone, m.phone),
           country            = coalesce(p_country, m.country)
     where m.id = p_model_id
    returning m.id into v_id;

    if v_id is null then
      raise exception 'model % not found', p_model_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

-- Record consent to send ONE compliance document's contents to the AI provider.
--
-- This is migration 014's `ai_analysis_opt_in` gate reached through an approval
-- tap instead of the portal toggle. 014's four properties are unchanged:
-- per-document, default OFF, read at CROSSING time (so revocation is
-- immediate), and writable only by super_admin/manager. What is new is that
-- the decision can be taken from Telegram, where the tap itself is the record.
--
-- Revocation is destructive of provider-derived content, mirroring
-- `setDocumentAiOptIn` in the portal exactly — a revoked document must not keep
-- displaying what a provider said about it.
create or replace function public.fn_agent_set_document_optin(
  p_approver    uuid,
  p_document_id uuid,
  p_opt_in      boolean
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

  update public.documents d
     set ai_analysis_opt_in = p_opt_in,
         ai_status         = case when p_opt_in then d.ai_status else null end,
         ai_summary        = case when p_opt_in then d.ai_summary else null end,
         ai_key_figures    = case when p_opt_in then d.ai_key_figures else null end,
         analysed_at       = case when p_opt_in then d.analysed_at else null end,
         analysed_provider = case when p_opt_in then d.analysed_provider else null end
   where d.id = p_document_id
  returning d.id into v_id;

  if v_id is null then
    raise exception 'document % not found', p_document_id using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agent_upsert_model(uuid, uuid, text, text, date, numeric, public.model_status, text, text, text)',
    'public.fn_agent_set_document_optin(uuid, uuid, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on function public.fn_agent_set_document_optin(uuid, uuid, boolean) is
  'Records per-document consent to send a compliance document to the AI provider, on behalf of an approving human (030). The gate is unchanged from 014: per-document, default off, read at crossing time, revocation immediate and destructive of stored analysis.';
