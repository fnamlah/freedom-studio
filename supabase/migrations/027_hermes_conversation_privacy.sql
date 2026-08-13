-- =============================================================================
-- 027 — Telegram conversations: attribution, and whose eyes they are for
-- -----------------------------------------------------------------------------
-- Hermes now holds conversations, and the owner has decided to keep them. That
-- turns two latent defects in `hermes_messages` into real ones:
--
--   1. NO ATTRIBUTION. The table has `channel_type` and `update_id` and nothing
--      else — a stored message cannot be traced to a chat or to a person. It was
--      built as a dedupe marker (015 §5) and is now also a conversation log.
--   2. NO OWNER. Every hermes table carries a blanket `hermes_sa_select`, so any
--      Super Admin could read any other's chats. The studio now has TWO Super
--      Admins. That directly contradicts the rule the app already holds itself
--      to for `ai_messages` (docs/11 §4, docs/04): conversations are "own-only
--      for every role, including the Super Admin… SA oversight happens through
--      `ai_usage` and `audit_log`, never by reading colleagues' chats."
--
-- This migration fixes both. It does NOT add a retention window: the owner chose
-- to keep history indefinitely, so pruning stays an operator procedure exactly
-- as audit-log archival does (docs/10 §5.8) rather than an in-app mutation.
--
-- Growth, stated plainly rather than discovered later: roughly 300 rows a day at
-- three active staff, so low hundreds of MB a year at the 4 KB body cap. Fine
-- for years on this instance. What degrades FIRST is read latency, not size —
-- the table had exactly one index — which is why the index below is required
-- rather than optional.
-- =============================================================================

set search_path = public, extensions;

-- ------------------------------------------------------------- attribution --
alter table public.hermes_messages
  add column if not exists chat_external_id text;

alter table public.hermes_messages
  add column if not exists channel_id uuid references public.hermes_channels (id) on delete cascade;

-- Reading one chat's history back is now a real operation, and the only index
-- on this table was the partial unique used for dedupe.
create index if not exists hermes_messages_chat_idx
  on public.hermes_messages (chat_external_id, created_at desc);

comment on table public.hermes_messages is
  'Every Telegram update Hermes has seen, and every reply it sent. Doubles as the dedupe ledger: the partial unique on (channel_type, update_id) is what makes a re-delivered update a no-op. Kept indefinitely by owner decision (027); pruning is an operator procedure, never an in-app mutation.';

comment on column public.hermes_messages.body is
  'The SCRUBBED text — the same bytes that crossed to the provider, so this row is also an egress record. Matches the property `ai_messages` holds (004). NULL for an unpaired sender: the dedupe marker needs only update_id, and a stranger''s words have no operational value.';

comment on column public.hermes_messages.channel_id is
  'The paired chat this belongs to, or NULL. NULL is meaningful: `markSeen` runs BEFORE the access check by design (a re-delivered pairing code must not re-run `tryPair`), so a message from an unpaired sender genuinely has no channel. channel_id IS NULL is therefore the stranger marker.';

comment on column public.hermes_messages.chat_external_id is
  'The Telegram chat id, known at dedupe time for free. Attributes a message even when there is no channel row — which is exactly the case an admin wants to see.';

comment on column public.hermes_messages.external_message_id is
  'For outbound rows, the Telegram message_id of the reply. The conversational turn edits one message as it works, so this identifies the message that ended up carrying the answer.';

-- Migration 015 left every table in this family uncommented. Recording intent
-- in SQL is the house style; these are the ones that were missing.
comment on table public.hermes_sessions is
  'One row per paired chat holding the bot''s short conversational memory. Written only by `hermes_session_append` (028). Not a log — the log is hermes_messages.';
comment on table public.hermes_runs is
  'Per-turn LLM telemetry. Reserved in 015 and still unwritten: spend is currently accumulated as a daily scalar in hermes_policy (`daily_cost_usd:<date>`) and per-turn timings are emitted to the worker log.';
comment on table public.hermes_tool_calls is
  'Reserved in 015 and unwritten. Note it records what the model ASKED for and has no `result` column, so it could never be the egress audit — that role belongs to the redactor''s projection.';

-- ------------------------------------------------------------------ privacy --
-- Conversations become own-only. The worker writes as the service role and is
-- unaffected; this governs who may READ in the app.
--
-- Unattributed rows (channel_id IS NULL) stay Super-Admin-readable on purpose:
-- they have no owner to be private FROM, and they are how someone probing the
-- bot becomes visible. A message with an owner is that owner's alone.
drop policy if exists hermes_sa_select on public.hermes_messages;
create policy hermes_messages_own_select on public.hermes_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.hermes_channels c
      where c.id = hermes_messages.channel_id
        and c.profile_id = (select auth.uid())
    )
    or (
      hermes_messages.channel_id is null
      and public.current_user_role() = 'super_admin'
    )
  );

drop policy if exists hermes_sa_select on public.hermes_sessions;
create policy hermes_sessions_own_select on public.hermes_sessions
  for select to authenticated
  using (
    exists (
      select 1
      from public.hermes_channels c
      where c.id = hermes_sessions.channel_id
        and c.profile_id = (select auth.uid())
    )
  );

-- The RESTRICTIVE aal2 + active-profile policy from 015 still ANDs with both of
-- these, and there is still no INSERT/UPDATE/DELETE policy for `authenticated`,
-- so writes remain service-role only (015 §"Writes are service-role only").
