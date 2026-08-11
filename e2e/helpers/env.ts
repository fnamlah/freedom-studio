import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal .env.local loader — the app itself is loaded by Next; the harness
 * runs under plain Node and needs the same values without adding dotenv.
 * Existing process.env values win (so CI/exported vars override the file).
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `E2E: missing env var ${name} (expected in .env.local or the environment)`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  loadEnv();
  return process.env[name] || undefined;
}
