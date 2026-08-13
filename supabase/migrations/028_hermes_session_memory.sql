-- =============================================================================
-- 028 — Conversational memory: one atomic append, and the rules live in SQL
-- -----------------------------------------------------------------------------
-- `hermes_sessions.conversation_state` was created in 015 under a section header
-- reading "Message dedupe + conversation memory" and has never held a byte.
-- This is what fills it.
--
-- WHY AN RPC RATHER THAN READ-MODIFY-WRITE IN TYPESCRIPT.
-- The worker serialises turns per chat in memory (`lib/keyed-queue.ts`), which
-- is enough while exactly one process consumes updates — and Telegram's
-- getUpdates is single-consumer, so normally there is. The exception is a
-- redeploy: the outgoing process is still draining a turn while the new one
-- starts. Two processes, two in-memory queues, one row. A read-modify-write
-- loses a turn there. `channel_id` is already UNIQUE, so the upsert below takes
-- a row lock and concurrent appends both survive, in commit order.
--
-- It also puts the retention rules in ONE place, where a comment can state
-- them, rather than splitting "how long" between SQL and TypeScript.
--
-- THE SHAPE, and why it is turn PAIRS rather than a message array:
--
--   { "v": 1,
--     "role": "finance",
--     "turns": [ { "user": "...", "assistant": "...", "at": "2026-…Z" } ] }
--
-- A pair CANNOT express an assistant message carrying `tool_calls`, so a
-- dangling `tool_call_id` can never be reconstructed out of storage. The app hit
-- this the other way round: `ai_messages` must hold tool rows because it is also
-- the egress audit, so its replay has to filter them out
-- (`src/app/api/ai/chat/route.ts`: re-feeding a tool stub "risks provider
-- tool-call linkage errors"). This table has no audit duty — that is
-- `hermes_messages` — so it can be a pure replay buffer and make the hazard
-- structurally impossible. Do not "improve" it into a messages array.
--
-- `role` is stored so that a ROLE CHANGE discards history: the assistant's prose
-- contains aggregates the previous role was entitled to see, and a demoted
-- person must not read them back out of the bot's memory.
-- =============================================================================

set search_path = public, extensions;

-- `updated_at` had no trigger; 015 set it on insert and never again.
drop trigger if exists set_updated_at on public.hermes_sessions;
create trigger set_updated_at before update on public.hermes_sessions
  for each row execute function public.set_updated_at();

comment on column public.hermes_sessions.conversation_state is
  'Short replay buffer: {v, role, turns[{user, assistant, at}]}. Scrubbed text only, and NEVER tool calls or tool results — a pair cannot represent one, which is what makes a dangling tool_call_id impossible on replay. Trimmed by hermes_session_append (028).';

comment on column public.hermes_sessions.last_inbound_at is
  'When the human last spoke. The idle-expiry anchor — NOT updated_at, which moves for any write. A thread older than the idle window is treated as a fresh conversation.';

-- -----------------------------------------------------------------------------
-- Append one exchange, trim by age and count, in a single statement.
--
-- `p_reset` lets the worker say "start fresh" (idle expired, or the person's
-- role changed) while SQL keeps ownership of how trimming works.
-- -----------------------------------------------------------------------------
create or replace function public.hermes_session_append(
  p_channel_id    uuid,
  p_user          text,
  p_assistant     text,
  p_role          text,
  p_keep          integer default 6,
  p_idle_minutes  integer default 30,
  p_reset         boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior jsonb := '[]'::jsonb;
  v_turn  jsonb;
begin
  if p_channel_id is null then
    raise exception 'hermes_session_append requires a channel' using errcode = '22023';
  end if;

  v_turn := jsonb_build_object(
    'user', coalesce(p_user, ''),
    'assistant', coalesce(p_assistant, ''),
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  if not p_reset then
    -- Keep only turns still inside the idle window. A gap longer than the
    -- window means the next question starts a new conversation, so nothing
    -- before it should be replayed.
    select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
      into v_prior
    from public.hermes_sessions s,
         lateral jsonb_array_elements(coalesce(s.conversation_state->'turns', '[]'::jsonb))
           with ordinality as x(t, ord)
    where s.channel_id = p_channel_id
      and coalesce(s.conversation_state->>'role', p_role) = p_role
      and (t->>'at')::timestamptz > now() - make_interval(mins => p_idle_minutes);
  end if;

  -- Newest p_keep, oldest first. Trimming whole PAIRS is why the shape is
  -- pairs: a question can never be replayed without its answer.
  v_prior := (
    select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
    from (
      select t, ord
      from jsonb_array_elements(v_prior) with ordinality as x(t, ord)
      order by ord desc
      limit greatest(p_keep - 1, 0)
    ) kept
  );

  insert into public.hermes_sessions (channel_id, conversation_state, last_inbound_at, updated_at)
  values (
    p_channel_id,
    jsonb_build_object('v', 1, 'role', p_role, 'turns', v_prior || jsonb_build_array(v_turn)),
    now(),
    now()
  )
  on conflict (channel_id) do update
    set conversation_state = excluded.conversation_state,
        last_inbound_at    = excluded.last_inbound_at,
        updated_at         = now();
end;
$$;

comment on function public.hermes_session_append(uuid, text, text, text, integer, integer, boolean) is
  'Appends one exchange to a chat''s replay buffer and trims it: drop turns outside the idle window, keep the newest p_keep, always whole pairs. One statement, so two workers overlapping during a redeploy cannot lose a turn (028).';

revoke all on function public.hermes_session_append(uuid, text, text, text, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.hermes_session_append(uuid, text, text, text, integer, integer, boolean)
  to service_role;
