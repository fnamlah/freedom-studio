import { broadcastStaff } from "../lib/owner.js";
import { hermesDict, money } from "../lib/i18n.js";
import { getAdminClient } from "../lib/supabase.js";

/**
 * Morning brief. Deliberately NOT an LLM call yet — the numbers are exact
 * aggregates and prose would only add a place for the model to be wrong. The
 * job is registered as `usesLlm` so the narration step can be added later
 * without changing the cost-cap wiring.
 */
export async function runMorningBrief(): Promise<string> {
  const db = getAdminClient();
  const month = new Date().toISOString().slice(0, 7);

  const [{ data: balances }, { data: payouts }, { data: compliance }] = await Promise.all([
    db.from("v_payee_balances").select("balance"),
    db.from("payouts").select("status").in("status", ["pending", "approved"]),
    db.from("v_document_compliance").select("status").in("status", ["expiring", "expired"]),
  ]);

  const owed = (balances ?? []).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
  const pending = (payouts ?? []).filter((p) => p.status === "pending").length;
  const approved = (payouts ?? []).filter((p) => p.status === "approved").length;
  const expired = (compliance ?? []).filter((c) => c.status === "expired").length;
  const expiring = (compliance ?? []).filter((c) => c.status === "expiring").length;

  await broadcastStaff((locale) => {
    const h = hermesDict(locale);
    return [
      `<b>${h.briefTitle(month)}</b>`,
      ``,
      h.briefOutstanding(money(owed, locale)),
      h.briefPayouts(pending, approved),
      h.briefCompliance(expired, expiring),
    ].join("\n");
  }, { html: true });
  return `owed=$${owed.toFixed(2)} pending=${pending} expired=${expired}`;
}
