import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { E2ERole } from "./naming";

/**
 * Persistent per-run state under e2e/.state/ (gitignored): the seeded users'
 * credentials + TOTP secrets, per-role Playwright storageState files, and
 * values specs hand to later specs (share URLs, entity ids).
 */
export const STATE_DIR = join(process.cwd(), "e2e", ".state");

export type E2EUser = {
  email: string;
  password: string;
  totpSecret: string;
  userId: string;
  /** business-row links, when the role has one */
  modelId?: string;
  operatorId?: string;
};

export type UsersFile = Partial<Record<E2ERole, E2EUser>>;

const USERS_PATH = join(STATE_DIR, "users.json");
const RUN_PATH = join(STATE_DIR, "run.json");

export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
}

export function storageStatePath(role: E2ERole): string {
  return join(STATE_DIR, `${role}.storage.json`);
}

export function hasStorageState(role: E2ERole): boolean {
  return existsSync(storageStatePath(role));
}

export function readUsers(): UsersFile {
  try {
    return JSON.parse(readFileSync(USERS_PATH, "utf8")) as UsersFile;
  } catch {
    return {};
  }
}

export function writeUsers(users: UsersFile): void {
  ensureStateDir();
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

/** Cross-spec scratch values (entity ids, the one-time share URL, run id). */
export function readRun(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(RUN_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeRun(patch: Record<string, string>): void {
  ensureStateDir();
  writeFileSync(RUN_PATH, JSON.stringify({ ...readRun(), ...patch }, null, 2));
}

/**
 * The role's AAL2 access token, recovered from the saved Playwright
 * storageState (the Supabase SSR cookie is base64 JSON, possibly chunked as
 * `sb-<ref>-auth-token.0`, `.1`, …). Used for direct PostgREST probes — RLS
 * negatives asserted at the database boundary rather than through UI politeness.
 */
export function accessTokenFromStorageState(role: E2ERole): string {
  const raw = readFileSync(storageStatePath(role), "utf8");
  const state = JSON.parse(raw) as {
    cookies: Array<{ name: string; value: string }>;
  };
  const chunks = state.cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => {
      const ai = Number(a.name.match(/\.(\d+)$/)?.[1] ?? -1);
      const bi = Number(b.name.match(/\.(\d+)$/)?.[1] ?? -1);
      return ai - bi;
    })
    .map((c) => c.value)
    .join("");
  if (!chunks) throw new Error(`No Supabase auth cookie in storageState for ${role}`);
  const json = chunks.startsWith("base64-")
    ? Buffer.from(chunks.slice("base64-".length), "base64").toString("utf8")
    : decodeURIComponent(chunks);
  const session = JSON.parse(json) as { access_token?: string };
  if (!session.access_token) throw new Error(`No access_token in session for ${role}`);
  return session.access_token;
}
