-- =============================================================================
-- 017 — Owner decision (2026-08-12): a second Super Admin, and named-staff
--       Telegram pairing
-- -----------------------------------------------------------------------------
-- docs/03 §2.2 enforced EXACTLY ONE super_admin with a partial unique index —
-- deliberately, so no service-role bug or console mistake could mint a second
-- root. The owner has now decided the studio is run by two people: Faisal and
-- Alina, each with full super_admin authority. The index is therefore dropped,
-- and the protection changes shape: from "there can be no second root" to
-- "every root is a named person, invited through the staged flow, behind
-- mandatory TOTP, and every use of root power lands in audit_log".
--
-- What does NOT change:
--   * role changes still travel only the guarded service-role server path;
--   * a super_admin still cannot be deactivated from the app (now protecting
--     each of the two from the other as well as from themselves);
--   * hermes governance is unaffected — decide_approval re-reads the actor's
--     role per decision, so a second SA simply becomes a second valid approver.
--
-- `expected_username` pins a Hermes pairing code to one Telegram username, so
-- a code minted for a specific person cannot be redeemed by whoever else finds
-- it first. NULL keeps the old behaviour (any chat may redeem).
-- =============================================================================

drop index if exists public.one_super_admin;

comment on table public.profiles is
  'Application identity for every auth.users row. Created by handle_new_user() from a pending invitation. Role changes only via the guarded service-role server path. The one_super_admin singleton index was dropped 2026-08-12 by owner decision (017): super_admin is now a named-person role held by two people, not a singleton.';

alter table public.hermes_pairing_codes
  add column if not exists expected_username text;

comment on column public.hermes_pairing_codes.expected_username is
  'Telegram username (without @) that must be the sender for this code to pair. NULL = any chat may redeem (017).';
