/**
 * Leftover-English scanner.
 *
 * `tsc` proves every dictionary key HAS a Russian value; it cannot prove a
 * component actually uses the dictionary. This finds the other half: English
 * prose still hardcoded in the UI.
 *
 *   node scripts/find-untranslated.mjs            # summary
 *   node scripts/find-untranslated.mjs --verbose  # every hit with line numbers
 *
 * It reports, it does not fail a build — the honest output includes a tail of
 * deliberate exceptions (brand names, provider labels, code identifiers), and a
 * script that cries wolf gets ignored.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const VERBOSE = process.argv.includes("--verbose");

/** Files that legitimately hold English: the dictionaries themselves, and model-facing prompts. */
const SKIP_FILES = [
  "src/lib/i18n/",
  "src/lib/database.types.ts",
  "src/lib/ai/registry.ts", // tool descriptions are model-facing, deliberately English
  "src/lib/ai/redactor.ts",
];

/** Substrings that are never user-facing prose. */
const NOISE = [
  /^[a-z0-9_.-]+$/i, // identifiers, slugs, mime types
  /^[A-Z_]+$/, // SCREAMING_CASE
  /^https?:\/\//,
  /^\/[a-z0-9/_[\]-]*$/i, // route paths
  /^#/, // colours, anchors
  /^\d/, // starts with a digit
  /^[^a-zA-Z]*$/, // no letters at all
];

const BRAND = /^(Freedom Studio|Freedom Hermes|Hermes|Supabase|Vercel|Telegram|Kimi|GLM|Moonshot|Zhipu|USD|EUR|RUB|AI|2FA|TOTP|RLS|CSV|PDF|UTC)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|ts)$/.test(full)) out.push(full);
  }
  return out;
}

function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/^\s*\/\/.*$/gm, "") // line comments
    .replace(/className=(["'])(?:(?!\1).)*\1/g, "") // tailwind
    .replace(/className=\{[\s\S]*?\}/g, "")
    .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "");
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.some((s) => rel.startsWith(s))) continue;

  const raw = readFileSync(file, "utf8");
  const cleaned = stripNoise(raw);

  // Prose-shaped string literals: start with a capital, contain a space or are
  // a multi-letter word, and are not obviously machine text.
  const hits = new Set();
  for (const m of cleaned.matchAll(/["'`]([A-Z][^"'`\n]{3,120})["'`]/g)) {
    const value = m[1].trim();
    if (NOISE.some((re) => re.test(value))) continue;
    if (BRAND.test(value)) continue;
    if (!/[a-z]/.test(value)) continue; // all-caps acronyms
    if (!/[A-Za-z]{3}/.test(value)) continue;
    // Cyrillic present means it is already translated inline (rare but fine).
    if (/[Ѐ-ӿ]/.test(value)) continue;
    hits.add(value);
  }

  // JSX text nodes: >Some words<
  for (const m of cleaned.matchAll(/>\s*([A-Z][A-Za-z][^<>{}\n]{2,120})\s*</g)) {
    const value = m[1].trim();
    if (NOISE.some((re) => re.test(value))) continue;
    if (BRAND.test(value)) continue;
    if (/[Ѐ-ӿ]/.test(value)) continue;
    hits.add(value);
  }

  if (hits.size) findings.push({ rel, hits: [...hits] });
}

findings.sort((a, b) => b.hits.length - a.hits.length);

const total = findings.reduce((n, f) => n + f.hits.length, 0);
console.log(`\nEnglish-looking strings outside the dictionary: ${total} in ${findings.length} files\n`);

for (const f of findings.slice(0, VERBOSE ? findings.length : 25)) {
  console.log(`${String(f.hits.length).padStart(4)}  ${f.rel}`);
  if (VERBOSE) for (const h of f.hits) console.log(`        ${h}`);
}

if (!VERBOSE && findings.length > 25) {
  console.log(`\n… and ${findings.length - 25} more files. Re-run with --verbose.`);
}
console.log("");
