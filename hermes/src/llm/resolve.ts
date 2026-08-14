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
    // Only the things that actually matched what they typed. Naming these is
    // the point of the question.
    return { ok: false, reason: "ambiguous", candidates: partial.map((r) => r.label).slice(0, 8) };
  }
  // NOT FOUND lists NOTHING. It used to answer "no document by that name;
  // known: <eight passport titles>" — an enumeration of the shelf, reached by
  // guessing a title, and it left through the unprojected tool-error path.
  // A miss is a miss.
  return { ok: false, reason: "not_found", candidates: [] };
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
): Promise<Resolved<{ id: string; label: string; modelId: string; platform: string }>> {
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
    platform: platformName_.get(a.platform_id) ?? "?",
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
  // Match the PLATFORM only. Matching the whole label meant a handle like
  // "@stripchat_lily" on Chaturbate answered to "Stripchat" — and an account
  // chosen that way decides which model an earning is written against.
  const want = platformName.trim().toLowerCase().replace(/^@+/, "");
  const byPlatform = rows.filter((r) => r.platform.toLowerCase() === want);
  if (byPlatform.length === 1) return { ok: true, value: byPlatform[0]! };
  const loose = rows.filter((r) => r.platform.toLowerCase().includes(want));
  if (loose.length === 1) return { ok: true, value: loose[0]! };
  return {
    ok: false,
    reason: loose.length > 1 ? "ambiguous" : "not_found",
    candidates: loose.map((r) => r.label),
  };
}

/**
 * A team member — operator, coach or team leader — by display name.
 *
 * `staff_role` travels with them so a card can say "coach Marta" rather than
 * "Marta", which is the difference between an approver noticing the wrong
 * person and not.
 */
export async function resolveOperator(
  name: string,
): Promise<Resolved<{ id: string; label: string; staffRole: string }>> {
  const { data, error } = await getAdminClient()
    .from("operators")
    .select("id, display_name, staff_role");
  if (error) throw new Error(`team lookup failed: ${error.message}`);
  return pick(
    (data ?? []).map((o) => ({
      id: o.id,
      label: o.display_name,
      staffRole: o.staff_role ?? "operator",
    })),
    name,
  );
}

/** A platform by name. */
export async function resolvePlatform(
  name: string,
): Promise<Resolved<{ id: string; label: string }>> {
  const { data, error } = await getAdminClient().from("platforms").select("id, name");
  if (error) throw new Error(`platform lookup failed: ${error.message}`);
  return pick(
    (data ?? []).map((p) => ({ id: p.id, label: p.name })),
    name,
  );
}

/** A compliance document by title, optionally scoped to one model. */
export async function resolveDocument(
  title: string,
  modelName?: string,
): Promise<Resolved<{ id: string; label: string; owner: string }>> {
  const db = getAdminClient();
  let query = db.from("documents").select("id, title, model_id");

  if (modelName) {
    const model = await resolveModel(modelName);
    if (!model.ok) return model;
    query = query.eq("model_id", model.value.id);
  }

  const [{ data, error }, { data: models }] = await Promise.all([
    query,
    db.from("models").select("id, stage_name"),
  ]);
  if (error) throw new Error(`document lookup failed: ${error.message}`);

  // The OWNER travels with the document. Searching studio-wide by title is
  // convenient and dangerous in equal measure — "passport" matches everyone's
  // — so whoever approves sending one must see whose it is on the card.
  const owner = new Map((models ?? []).map((m) => [m.id, m.stage_name]));
  return pick(
    (data ?? []).map((d) => ({
      id: d.id,
      label: d.title,
      owner: owner.get(d.model_id) ?? "unknown",
    })),
    title,
  );
}

/** Turn a failed resolution into something the model can say out loud. */
export function explain(r: Extract<Resolved<unknown>, { ok: false }>, what: string): string {
  return r.reason === "ambiguous"
    ? `Several ${what} match that. Which one: ${r.candidates.join(", ")}?`
    : `No ${what} found by that name.`;
}
