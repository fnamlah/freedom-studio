import { getAdminClient } from "../lib/supabase.js";
import { broadcastStaff } from "../lib/owner.js";
import { escapeHtml } from "../telegram/api.js";

/**
 * Compliance watch — the cheapest useful thing the agent does: no LLM, no
 * writes, no approval. It reads the same derivation the app shows and tells a
 * human when a performer's paperwork is about to lapse.
 */
export async function runComplianceWatch(): Promise<string> {
  const db = getAdminClient();

  // v_document_compliance derives status from expires_at (docs/06 §4) — the
  // same rule the UI renders, so the alert can never disagree with the screen.
  const { data, error } = await db
    .from("v_document_compliance")
    .select("document_id, model_id, doc_type, title, expires_at, status")
    .in("status", ["expiring", "expired"]);
  if (error) throw new Error(`compliance query: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return "no expiring or expired documents";

  const modelIds = [...new Set(rows.map((r) => r.model_id).filter((id): id is string => id !== null))];
  const { data: models } = await db.from("models").select("id, stage_name").in("id", modelIds);
  const nameOf = new Map((models ?? []).map((m) => [m.id, m.stage_name]));

  const expired = rows.filter((r) => r.status === "expired");
  const expiring = rows.filter((r) => r.status === "expiring");

  // Stage names only — legal names are on the redactor's blocklist and have no
  // business in a phone notification either.
  const line = (r: (typeof rows)[number]) =>
    `• ${escapeHtml((r.model_id ? nameOf.get(r.model_id) : null) ?? "Unknown")} — ${escapeHtml(String(r.doc_type))}` +
    (r.expires_at ? ` (${String(r.expires_at).slice(0, 10)})` : "");

  const parts = [`<b>Compliance watch</b>`];
  if (expired.length) parts.push(`\n<b>Expired (${expired.length})</b>\n${expired.slice(0, 15).map(line).join("\n")}`);
  if (expiring.length) parts.push(`\n<b>Expiring within 30 days (${expiring.length})</b>\n${expiring.slice(0, 15).map(line).join("\n")}`);

  const sent = await broadcastStaff(parts.join("\n"), { html: true });
  if (sent === 0) {
    console.warn(
      `[compliance] no paired staff chat — ${expired.length} expired, ${expiring.length} expiring`,
    );
  }

  return `${expired.length} expired, ${expiring.length} expiring`;
}
