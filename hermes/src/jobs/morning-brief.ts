import { ownerChatId } from "../lib/owner.js";
import { getAdminClient } from "../lib/supabase.js";
import { sendMessage } from "../telegram/api.js";

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

  const text = [
    `<b>Freedom Studio — ${month}</b>`,
    ``,
    `Outstanding to payees: <b>$${owed.toFixed(2)}</b>`,
    `Payouts: ${pending} pending · ${approved} approved awaiting settlement`,
    `Compliance: ${expired} expired · ${expiring} expiring`,
  ].join("\n");

  const chatId = await ownerChatId();
  if (chatId) await sendMessage(chatId, text, { html: true });
  return `owed=$${owed.toFixed(2)} pending=${pending} expired=${expired}`;
}
