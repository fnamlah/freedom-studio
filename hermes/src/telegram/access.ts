/**
 * Who may talk to the bot, and what each role may ask of it.
 *
 * Pure data and pure functions — no env, no database — so the governance test
 * suite can pin this behaviour without booting anything. The rules mirror the
 * app's capability matrix (docs/03 §3) rather than inventing a second
 * permission system that could drift from it:
 *
 *   * Only senior staff roles may hold a bot channel at all. Models and
 *     operators see ONLY their own rows in the app; the bot answers from a
 *     service-role client that sees everything, so giving them a channel would
 *     be a privilege escalation, not a convenience.
 *   * The kill switch is the owner's: /pause and /resume stop the studio's
 *     automation, which is super_admin surface exactly like the app's settings.
 *   * Deciding an approval is NOT gated here. That authority lives in
 *     `decide_approval`, which re-reads the actor's role in the database for
 *     every decision — this module only decides what is worth showing.
 */

export const BOT_ROLES: ReadonlySet<string> = new Set(["super_admin", "manager", "finance"]);

const SUPER_ADMIN_ONLY = new Set(["/pause", "/resume"]);

export function roleMayUseBot(role: string | null | undefined): boolean {
  return typeof role === "string" && BOT_ROLES.has(role);
}

export function commandAllowed(role: string, command: string): boolean {
  if (!roleMayUseBot(role)) return false;
  if (SUPER_ADMIN_ONLY.has(command)) return role === "super_admin";
  return true;
}
