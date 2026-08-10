-- =============================================================================
-- 008_rls_policies.sql — Freedom Studio
-- -----------------------------------------------------------------------------
-- Row Level Security for every table: the restrictive AAL2 + active-profile
-- layer, then the permissive per-role grants implementing the policy-intent
-- matrix of docs/04-database-erd.md §7.2 exactly.
--
-- The layering (docs/04 §7.1, docs/05 §5):
--   1. ONE RESTRICTIVE policy per table requiring an AAL2 session and an active
--      profile. Restrictive policies are ANDed on top of whatever the permissive
--      ones grant, so a forgotten check in a future permissive policy cannot
--      reopen the door. A stolen AAL1 token reads zero rows even if the
--      middleware never runs.
--   2. Permissive per-role policies below.
--
-- Deny-by-default is expressed by ABSENCE: every "deny" cell in the matrix has
-- no policy at all. In particular there is no UPDATE or DELETE policy on
-- audit_log, ledger_entries or ai_messages for ANY role, including super_admin —
-- the absence of a policy IS the append-only enforcement, and there is nothing
-- to misconfigure. share_rate_limits gets no permissive policy whatsoever: it is
-- service-role-only infrastructure for the share-view Edge Function.
--
-- Every policy is `to authenticated`; the anon role holds no grant of any kind
-- anywhere in this schema (table privileges are revoked from it at the end of
-- this file). The only anonymous surface in the system is the share-view Edge
-- Function, which runs with the service-role key.
-- =============================================================================

set search_path = public, extensions;

-- =============================================================================
-- 1. Enable RLS + the canonical restrictive policy on EVERY table
-- -----------------------------------------------------------------------------
-- The policy body is the canonical snippet from docs/05-auth-2fa.md §5, copied
-- verbatim. `(select auth.jwt()->>'aal')` stays wrapped in a subselect so the
-- planner evaluates it once per statement rather than once per row.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    -- core (002)
    'profiles', 'models', 'operators', 'invitations', 'platforms',
    'platform_accounts', 'work_sessions', 'earnings', 'operator_assignments',
    'documents', 'document_shares', 'document_share_views', 'audit_log',
    'app_settings', 'share_rate_limits',
    -- accounting (003)
    'commission_schemes', 'payouts', 'ledger_entries', 'forecast_snapshots',
    -- ai (004)
    'ai_conversations', 'ai_messages', 'ai_usage', 'embeddings', 'ai_reports',
    -- library (005)
    'doc_categories', 'library_files'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists aal2_active_required on public.%I', t);
    execute format(
      'create policy aal2_active_required on public.%I
         as restrictive for all to authenticated
         using ( (select auth.jwt()->>''aal'') = ''aal2'' and public.is_active_profile() )', t);
  end loop;
end
$$;

-- =============================================================================
-- 2. profiles — SA CRUD; MGR read all + update contact of non-admins;
--    self read (+ update contact for model/operator)
-- =============================================================================
drop policy if exists profiles_sa_all on public.profiles;
create policy profiles_sa_all on public.profiles
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated
  using (profiles.id = auth.uid());

drop policy if exists profiles_mgr_select on public.profiles;
create policy profiles_mgr_select on public.profiles
  for select to authenticated
  using (public.current_user_role() = 'manager');

-- The WITH CHECK is the privilege-escalation guard: role and status must equal
-- the stored values, so contact-field edits can never become a role change
-- (docs/04 §7.3, docs/08 privilege-escalation row).
drop policy if exists profiles_mgr_update on public.profiles;
create policy profiles_mgr_update on public.profiles
  for update to authenticated
  using (
    public.current_user_role() = 'manager'
    and profiles.role <> 'super_admin'
  )
  with check (
    public.current_user_role() = 'manager'
    and profiles.role <> 'super_admin'
    and public.profile_fields_unchanged(profiles.id, profiles.role, profiles.status)
  );

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (
    profiles.id = auth.uid()
    and public.current_user_role() in ('model', 'operator')
  )
  with check (
    profiles.id = auth.uid()
    and public.profile_fields_unchanged(profiles.id, profiles.role, profiles.status)
  );

-- =============================================================================
-- 3. models / operators
-- -----------------------------------------------------------------------------
-- Finance reads rows but the application only ever queries the directory views
-- (v_model_directory / v_operator_directory). RLS restricts rows, not columns —
-- column shaping is the views' job, exactly as docs/04 §7.3 states.
-- =============================================================================
drop policy if exists models_admin_all on public.models;
create policy models_admin_all on public.models
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists models_self_select on public.models;
create policy models_self_select on public.models
  for select to authenticated
  using (models.profile_id = auth.uid());

drop policy if exists models_finance_select on public.models;
create policy models_finance_select on public.models
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists operators_admin_all on public.operators;
create policy operators_admin_all on public.operators
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists operators_self_select on public.operators;
create policy operators_self_select on public.operators
  for select to authenticated
  using (operators.profile_id = auth.uid());

drop policy if exists operators_finance_select on public.operators;
create policy operators_finance_select on public.operators
  for select to authenticated
  using (public.current_user_role() = 'finance');

-- =============================================================================
-- 4. invitations — super_admin only, no exceptions
-- =============================================================================
drop policy if exists invitations_sa_all on public.invitations;
create policy invitations_sa_all on public.invitations
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- =============================================================================
-- 5. platforms / platform_accounts / work_sessions / earnings
-- =============================================================================
drop policy if exists platforms_admin_all on public.platforms;
create policy platforms_admin_all on public.platforms
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists platforms_read on public.platforms;
create policy platforms_read on public.platforms
  for select to authenticated
  using (public.current_user_role() in ('model', 'finance'));

drop policy if exists platform_accounts_admin_all on public.platform_accounts;
create policy platform_accounts_admin_all on public.platform_accounts
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists platform_accounts_model_select_own on public.platform_accounts;
create policy platform_accounts_model_select_own on public.platform_accounts
  for select to authenticated
  using (platform_accounts.model_id = public.my_model_id());

drop policy if exists platform_accounts_finance_select on public.platform_accounts;
create policy platform_accounts_finance_select on public.platform_accounts
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists work_sessions_admin_all on public.work_sessions;
create policy work_sessions_admin_all on public.work_sessions
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists work_sessions_model_select_own on public.work_sessions;
create policy work_sessions_model_select_own on public.work_sessions
  for select to authenticated
  using (work_sessions.model_id = public.my_model_id());

drop policy if exists work_sessions_finance_select on public.work_sessions;
create policy work_sessions_finance_select on public.work_sessions
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists earnings_admin_all on public.earnings;
create policy earnings_admin_all on public.earnings
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists earnings_model_select_own on public.earnings;
create policy earnings_model_select_own on public.earnings
  for select to authenticated
  using (earnings.model_id = public.my_model_id());

drop policy if exists earnings_finance_select on public.earnings;
create policy earnings_finance_select on public.earnings
  for select to authenticated
  using (public.current_user_role() = 'finance');

-- =============================================================================
-- 6. operator_assignments — operators see only their own assignments
-- =============================================================================
drop policy if exists operator_assignments_admin_all on public.operator_assignments;
create policy operator_assignments_admin_all on public.operator_assignments
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists operator_assignments_finance_select on public.operator_assignments;
create policy operator_assignments_finance_select on public.operator_assignments
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists operator_assignments_operator_select_own on public.operator_assignments;
create policy operator_assignments_operator_select_own on public.operator_assignments
  for select to authenticated
  using (operator_assignments.operator_id = public.my_operator_id());

-- =============================================================================
-- 7. commission_schemes — super_admin writes; manager and finance read
-- =============================================================================
drop policy if exists commission_schemes_sa_all on public.commission_schemes;
create policy commission_schemes_sa_all on public.commission_schemes
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists commission_schemes_read on public.commission_schemes;
create policy commission_schemes_read on public.commission_schemes
  for select to authenticated
  using (public.current_user_role() in ('manager', 'finance'));

-- =============================================================================
-- 8. ledger_entries — append-only: INSERT + SELECT only, never UPDATE/DELETE
-- =============================================================================
drop policy if exists ledger_entries_insert on public.ledger_entries;
create policy ledger_entries_insert on public.ledger_entries
  for insert to authenticated
  with check (public.current_user_role() in ('super_admin', 'finance'));

drop policy if exists ledger_entries_staff_select on public.ledger_entries;
create policy ledger_entries_staff_select on public.ledger_entries
  for select to authenticated
  using (public.current_user_role() in ('super_admin', 'manager', 'finance'));

drop policy if exists ledger_entries_model_select_own on public.ledger_entries;
create policy ledger_entries_model_select_own on public.ledger_entries
  for select to authenticated
  using (ledger_entries.payee_type = 'model' and ledger_entries.payee_id = public.my_model_id());

drop policy if exists ledger_entries_operator_select_own on public.ledger_entries;
create policy ledger_entries_operator_select_own on public.ledger_entries
  for select to authenticated
  using (ledger_entries.payee_type = 'operator' and ledger_entries.payee_id = public.my_operator_id());

-- =============================================================================
-- 9. payouts — the maker-checker state machine
-- -----------------------------------------------------------------------------
--   super_admin : full CRUD, and the only role whose WITH CHECK permits
--                 status = 'approved'.
--   manager     : create pending, read all, update while pending.
--   finance     : create pending, read all, update pending, and settle
--                 ('approved' -> 'paid'). Its WITH CHECK forbids writing
--                 'approved' at all.
--   model/oper. : read own.
-- A WITH CHECK sees only the NEW row, so "paid only FROM approved" is enforced
-- by the enforce_payout_transition trigger (007) alongside these policies.
-- =============================================================================
drop policy if exists payouts_sa_all on public.payouts;
create policy payouts_sa_all on public.payouts
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists payouts_mgr_insert on public.payouts;
create policy payouts_mgr_insert on public.payouts
  for insert to authenticated
  with check (public.current_user_role() = 'manager' and payouts.status = 'pending');

drop policy if exists payouts_mgr_select on public.payouts;
create policy payouts_mgr_select on public.payouts
  for select to authenticated
  using (public.current_user_role() = 'manager');

drop policy if exists payouts_mgr_update_pending on public.payouts;
create policy payouts_mgr_update_pending on public.payouts
  for update to authenticated
  using (public.current_user_role() = 'manager' and payouts.status = 'pending')
  with check (public.current_user_role() = 'manager' and payouts.status = 'pending');

drop policy if exists payouts_fin_insert on public.payouts;
create policy payouts_fin_insert on public.payouts
  for insert to authenticated
  with check (public.current_user_role() = 'finance' and payouts.status = 'pending');

drop policy if exists payouts_fin_select on public.payouts;
create policy payouts_fin_select on public.payouts
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists payouts_fin_update on public.payouts;
create policy payouts_fin_update on public.payouts
  for update to authenticated
  using (public.current_user_role() = 'finance' and payouts.status in ('pending', 'approved'))
  with check (public.current_user_role() = 'finance' and payouts.status <> 'approved');

drop policy if exists payouts_model_select_own on public.payouts;
create policy payouts_model_select_own on public.payouts
  for select to authenticated
  using (payouts.payee_type = 'model' and payouts.payee_id = public.my_model_id());

drop policy if exists payouts_operator_select_own on public.payouts;
create policy payouts_operator_select_own on public.payouts
  for select to authenticated
  using (payouts.payee_type = 'operator' and payouts.payee_id = public.my_operator_id());

-- =============================================================================
-- 10. forecast_snapshots — SA CRUD, manager read, finance create + read
-- =============================================================================
drop policy if exists forecast_snapshots_sa_all on public.forecast_snapshots;
create policy forecast_snapshots_sa_all on public.forecast_snapshots
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists forecast_snapshots_mgr_select on public.forecast_snapshots;
create policy forecast_snapshots_mgr_select on public.forecast_snapshots
  for select to authenticated
  using (public.current_user_role() = 'manager');

drop policy if exists forecast_snapshots_fin_select on public.forecast_snapshots;
create policy forecast_snapshots_fin_select on public.forecast_snapshots
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists forecast_snapshots_fin_insert on public.forecast_snapshots;
create policy forecast_snapshots_fin_insert on public.forecast_snapshots
  for insert to authenticated
  with check (public.current_user_role() = 'finance');

-- =============================================================================
-- 11. documents / document_shares / document_share_views
-- -----------------------------------------------------------------------------
-- Finance and operators are denied documents ENTIRELY — a deliberate
-- least-privilege stance (docs/03, docs/08 insider-misuse). The storage-bucket
-- policies in 010 mirror this exactly.
-- =============================================================================
drop policy if exists documents_admin_all on public.documents;
create policy documents_admin_all on public.documents
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists documents_model_select_own on public.documents;
create policy documents_model_select_own on public.documents
  for select to authenticated
  using (documents.model_id = public.my_model_id());

drop policy if exists document_shares_sa_all on public.document_shares;
create policy document_shares_sa_all on public.document_shares
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists document_shares_mgr_insert on public.document_shares;
create policy document_shares_mgr_insert on public.document_shares
  for insert to authenticated
  with check (public.current_user_role() = 'manager');

drop policy if exists document_shares_mgr_select on public.document_shares;
create policy document_shares_mgr_select on public.document_shares
  for select to authenticated
  using (public.current_user_role() = 'manager');

-- A manager's update capability is scoped to revocation: the new row must be
-- revoked, so there is no path to extending expiry or raising max_views.
drop policy if exists document_shares_mgr_revoke on public.document_shares;
create policy document_shares_mgr_revoke on public.document_shares
  for update to authenticated
  using (public.current_user_role() = 'manager')
  with check (public.current_user_role() = 'manager' and document_shares.revoked_at is not null);

drop policy if exists document_share_views_sa_select on public.document_share_views;
create policy document_share_views_sa_select on public.document_share_views
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists document_share_views_mgr_select on public.document_share_views;
create policy document_share_views_mgr_select on public.document_share_views
  for select to authenticated
  using (
    public.current_user_role() = 'manager'
    and exists (
      select 1
      from public.document_shares ds
      where ds.id = document_share_views.share_id
        and ds.created_by = auth.uid()
    )
  );

-- =============================================================================
-- 12. audit_log — super_admin reads; nobody writes or deletes in-app
-- =============================================================================
drop policy if exists audit_log_sa_select on public.audit_log;
create policy audit_log_sa_select on public.audit_log
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

-- =============================================================================
-- 13. app_settings — SA reads + updates (trigger-validated, audited);
--     manager and finance read. No INSERT policy for anyone: seeds arrive by
--     migration only.
-- =============================================================================
drop policy if exists app_settings_sa_select on public.app_settings;
create policy app_settings_sa_select on public.app_settings
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists app_settings_sa_update on public.app_settings;
create policy app_settings_sa_update on public.app_settings
  for update to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated
  using (public.current_user_role() in ('manager', 'finance'));

-- =============================================================================
-- 14. AI tables
-- -----------------------------------------------------------------------------
-- Conversations and messages are OWN-ONLY for every role including super_admin;
-- oversight runs through ai_usage and audit_log (docs/11 §2). Model and operator
-- have no permissive AI policy at all — their exclusion from the AI surface is
-- enforced by the database, not the UI.
-- =============================================================================
drop policy if exists ai_conversations_own_all on public.ai_conversations;
create policy ai_conversations_own_all on public.ai_conversations
  for all to authenticated
  using (
    ai_conversations.user_id = auth.uid()
    and public.current_user_role() in ('super_admin', 'manager', 'finance')
  )
  with check (
    ai_conversations.user_id = auth.uid()
    and public.current_user_role() in ('super_admin', 'manager', 'finance')
  );

-- Append-only within a conversation: INSERT + SELECT, no UPDATE/DELETE policy.
drop policy if exists ai_messages_own_insert on public.ai_messages;
create policy ai_messages_own_insert on public.ai_messages
  for insert to authenticated
  with check (
    ai_messages.user_id = auth.uid()
    and public.current_user_role() in ('super_admin', 'manager', 'finance')
  );

drop policy if exists ai_messages_own_select on public.ai_messages;
create policy ai_messages_own_select on public.ai_messages
  for select to authenticated
  using (
    ai_messages.user_id = auth.uid()
    and public.current_user_role() in ('super_admin', 'manager', 'finance')
  );

drop policy if exists ai_usage_sa_select on public.ai_usage;
create policy ai_usage_sa_select on public.ai_usage
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists ai_usage_own_select on public.ai_usage;
create policy ai_usage_own_select on public.ai_usage
  for select to authenticated
  using (
    ai_usage.user_id = auth.uid()
    and public.current_user_role() in ('manager', 'finance')
  );

-- Embedding reads never exceed source-row visibility: finance is denied notes
-- and documents, so finance's semantic search is honestly platform-only.
drop policy if exists embeddings_admin_select on public.embeddings;
create policy embeddings_admin_select on public.embeddings
  for select to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'));

drop policy if exists embeddings_finance_select on public.embeddings;
create policy embeddings_finance_select on public.embeddings
  for select to authenticated
  using (public.current_user_role() = 'finance' and embeddings.source_type = 'platform');

drop policy if exists ai_reports_sa_select on public.ai_reports;
create policy ai_reports_sa_select on public.ai_reports
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists ai_reports_sa_insert on public.ai_reports;
create policy ai_reports_sa_insert on public.ai_reports
  for insert to authenticated
  with check (public.current_user_role() = 'super_admin');

drop policy if exists ai_reports_sa_delete on public.ai_reports;
create policy ai_reports_sa_delete on public.ai_reports
  for delete to authenticated
  using (public.current_user_role() = 'super_admin');

drop policy if exists ai_reports_fin_select on public.ai_reports;
create policy ai_reports_fin_select on public.ai_reports
  for select to authenticated
  using (public.current_user_role() = 'finance');

drop policy if exists ai_reports_fin_insert on public.ai_reports;
create policy ai_reports_fin_insert on public.ai_reports
  for insert to authenticated
  with check (public.current_user_role() = 'finance');

-- =============================================================================
-- 15. Library — super_admin and manager only; every other role has no policy
--     at all, so the Library is invisible to them.
-- =============================================================================
drop policy if exists doc_categories_sa_all on public.doc_categories;
create policy doc_categories_sa_all on public.doc_categories
  for all to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- Managers file documents but do not define the vocabulary the classifier is
-- prompted with: doc_categories is read-only for them.
drop policy if exists doc_categories_mgr_select on public.doc_categories;
create policy doc_categories_mgr_select on public.doc_categories
  for select to authenticated
  using (public.current_user_role() = 'manager');

drop policy if exists library_files_admin_all on public.library_files;
create policy library_files_admin_all on public.library_files
  for all to authenticated
  using (public.current_user_role() in ('super_admin', 'manager'))
  with check (public.current_user_role() in ('super_admin', 'manager'));

-- =============================================================================
-- 16. Table privileges
-- -----------------------------------------------------------------------------
-- RLS is the authority on WHICH rows; these grants only make the tables
-- addressable at all. anon is stripped of everything: it must never reach a
-- table, with or without policies.
-- =============================================================================
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
