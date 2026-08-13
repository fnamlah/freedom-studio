import { getAdminClient } from "../lib/supabase.js";

/**
 * Business names in, ids out.
 *
 * The same rule the app's tool registry states: "Business names, never UUIDs —
 * this module resolves them to ids via the directory views, so the model never
 * sees or supplies a UUID." Alina says "Лилия", not a uuid, and a model that is
 * never shown an id cannot invent a plausible-looking one.
 *
 * Every resolver is deliberately strict about ambiguity. Two models whose names
 * both contain the search term is not a 50/50 guess — it is a question for the
 * human, because the wrong answer here writes money to the wrong person.
 */

export type Resolved<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "ambiguous"; candidates: string[] };

function pick<T extends { id: string; label: string }>(
  rows: T[],
  needle: string,
): Resolved<T> {
  const want = needle.trim().toLowerCase();
  if (!want) return { ok: false, reason: "not_found", candidates: [] };

  const exact = rows.filter((r) => r.label.toLowerCase() === want);
  if (exact.length === 1) return { ok: true, value: exact[0]! };

  const partial = rows.filter((r) => r.label.toLowerCase().includes(want));
  if (partial.length === 1) return { ok: true, value: partial[0]! };
  if (partial.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: partial.map((r) => r.label).slice(0, 8) };
  }
  return { ok: false, reason: "not_found", candidates: rows.map((r) => r.label).slice(0, 8) };
}

/** A model by stage name. */
export async function resolveModel(name: string): Promise<Resolved<{ id: string; label: string }>> {
  const { data, error } = await getAdminClient().from("models").select("id, stage_name");
  if (error) throw new Error(`model lookup failed: ${error.message}`);
  return pick(
    (data ?? []).map((m) => ({ id: m.id, label: m.stage_name })),
    name,
  );
}

/**
 * A platform account, named as the person would say it: a model's account,
 * optionally narrowed by platform ("Лилия on Stripchat").
 */
export async function resolveAccount(
  modelName: string,
  platformName?: string,
): Promise<Resolved<{ id: string; label: string; modelId: string }>> {
  const db = getAdminClient();
  const model = await resolveModel(modelName);
  if (!model.ok) return model;

  const [{ data: accounts, error }, { data: platforms }] = await Promise.all([
    db.from("platform_accounts").select("id, username, platform_id").eq("model_id", model.value.id),
    db.from("platforms").select("id, name"),
  ]);
  if (error) throw new Error(`account lookup failed: ${error.message}`);

  const platformName_ = new Map((platforms ?? []).map((p) => [p.id, p.name]));
  const rows = (accounts ?? []).map((a) => ({
    id: a.id,
    modelId: model.value.id,
    label: `${platformName_.get(a.platform_id) ?? "?"} · @${a.username}`,
  }));

  if (rows.length === 0) {
    return { ok: false, reason: "not_found", candidates: [] };
  }
  // One account is unambiguous even without a platform named.
  if (!platformName && rows.length === 1) return { ok: true, value: rows[0]! };
  if (!platformName) {
    return { ok: false, reason: "ambiguous", candidates: rows.map((r) => r.label) };
  }
  return pick(rows, platformName) as Resolved<{ id: string; label: string; modelId: string }>;
}

/** A compliance document by title, optionally scoped to one model. */
export async function resolveDocument(
  title: string,
  modelName?: string,
): Promise<Resolved<{ id: string; label: string }>> {
  const db = getAdminClient();
  let query = db.from("documents").select("id, title, model_id");

  if (modelName) {
    const model = await resolveModel(modelName);
    if (!model.ok) return model;
    query = query.eq("model_id", model.value.id);
  }

  const { data, error } = await query;
  if (error) throw new Error(`document lookup failed: ${error.message}`);
  return pick(
    (data ?? []).map((d) => ({ id: d.id, label: d.title })),
    title,
  );
}

/** Turn a failed resolution into something the model can say out loud. */
export function explain(r: Extract<Resolved<unknown>, { ok: false }>, what: string): string {
  return r.reason === "ambiguous"
    ? `Several ${what} match that. Which one: ${r.candidates.join(", ")}?`
    : r.candidates.length
      ? `No ${what} by that name. Known: ${r.candidates.join(", ")}.`
      : `No ${what} found by that name.`;
}
