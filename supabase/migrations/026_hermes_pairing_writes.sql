-- =============================================================================
-- 026 — Let a Super Admin actually pair someone with the bot
-- -----------------------------------------------------------------------------
-- `hermes_pairing_codes` and `hermes_channels` shipped in 015 with SELECT-only
-- policies for super_admin. That was correct for how pairing worked then — the
-- worker reads them with the service role, and the two codes ever issued were
-- typed by hand in SQL, which bypasses RLS entirely.
--
-- The consequence only surfaced when the app grew a pairing screen: the studio's
-- second Super Admin could SEE the pairing surface and get no error, because the
-- INSERT was refused by RLS while every read succeeded. A person with no way to
-- pair, and no message saying why.
--
-- So: grant exactly the two writes that surface needs, and no more.
--
-- The INSERT policy re-states the bot's OWN eligibility rule
-- (`hermes/src/telegram/access.ts`: BOT_ROLES = super_admin | manager | finance,
-- and an active profile) as a WITH CHECK. The app already refuses ineligible
-- targets for a friendly message, but the app is UX; this makes the database the
-- thing that cannot be talked out of it. A code the bot would refuse can no
-- longer be written at all.
--
-- Deliberately NOT granted: DELETE on either table. A redeemed code and a
-- revoked channel are how a past instruction is attributed to a person, so they
-- are deactivated (`used_at`, `is_active`), never erased.
-- =============================================================================

set search_path = public, extensions;

-- Minting a code. Super Admin only, and only for someone the bot will accept.
drop policy if exists hermes_pairing_sa_insert on public.hermes_pairing_codes;
create policy hermes_pairing_sa_insert on public.hermes_pairing_codes
  for insert to authenticated
  with check (
    public.current_user_role() = 'super_admin'
    and exists (
      select 1
      from public.profiles p
      where p.id = hermes_pairing_codes.profile_id
        and p.status = 'active'
        and p.role in ('super_admin', 'manager', 'finance')
    )
  );

-- Revoking a channel. Super Admin only. The AAL2 + active-profile restrictive
-- policy from 015 still applies on top of this, as it does to every write.
drop policy if exists hermes_channels_sa_update on public.hermes_channels;
create policy hermes_channels_sa_update on public.hermes_channels
  for update to authenticated
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

comment on table public.hermes_pairing_codes is
  'One-time, expiring Telegram pairing codes, pinned to a Telegram username. Minted by a Super Admin on /admin/hermes; redeemed once by the bot, which marks used_at. Insertable only for an active, bot-eligible profile (026).';
