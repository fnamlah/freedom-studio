import { roleSatisfies } from "../governance/policy.js";
import { todaysCost } from "../lib/cost.js";
import { getPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { escapeHtml, sendApprovalCard, sendMessage } from "./api.js";

/**
 * Deterministic slash commands.
 *
 * These deliberately do NOT go through the LLM. Staff asking "what is my cost
 * today" should get a number read from the database, not a number a model
 * chose to say — and a command that never reaches a provider cannot leak
 * anything to one. Free-text messages are what the model is for.
 *
 * Role gating happened in the handler (access.ts) before this runs; the one
 * role decision made HERE is which approvals are worth showing — only the ones
 * this person could actually decide. `decide_approval` remains the authority.
 *
 * Returns true when the command was recognised and answered.
 */

export interface CommandContext {
  command: string;
  chatId: number | string;
  profileId: string;
  role: string;
  text: string;
}

const HELP = [
  "<b>Freedom Hermes</b>",
  "",
  "/brief — today's KPI digest",
  "/compliance — documents expiring or expired",
  "/balances — outstanding payee balances",
  "/approvals — pending proposals awaiting your decision",
  "/cost — AI spend today against the cap",
  "/status — loop heartbeats and job health",
  "/pause, /resume — the kill switch",
  "/help — this message",
].join("\n");

function money(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ageMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60_000);
}

async function showBalances(chatId: number | string): Promise<void> {
  const { data, error } = await getAdminClient()
    .from("v_payee_balances")
    .select("payee_type, display_name, balance")
    .gt("balance", 0)
    .order("balance", { ascending: false })
    .limit(15);

  if (error) {
    await sendMessage(chatId, `Could not read balances: ${escapeHtml(error.message)}`);
    return;
  }
  if (!data?.length) {
    await sendMessage(chatId, "No outstanding balances.");
    return;
  }

  const lines = data.map(
    (r) =>
      `• ${escapeHtml(String(r.display_name ?? "—"))} (${escapeHtml(String(r.payee_type ?? "—"))}) — <b>${money(r.balance)}</b>`,
  );
  await sendMessage(chatId, [`<b>Outstanding balances</b>`, ...lines].join("\n"));
}

async function showApprovals(chatId: number | string, role: string): Promise<void> {
  const { data, error } = await getAdminClient()
    .from("hermes_approvals")
    .select("id, action_type, required_role, preview, created_at, expires_at")
    .eq("state", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    await sendMessage(chatId, `Could not read approvals: ${escapeHtml(error.message)}`);
    return;
  }

  // Cards only for proposals this person could actually decide. Sending a
  // manager a finance approval card would render buttons that can only fail.
  const decidable = (data ?? []).filter((row) => roleSatisfies(role, String(row.required_role)));
  const otherCount = (data ?? []).length - decidable.length;

  if (decidable.length === 0) {
    await sendMessage(
      chatId,
      otherCount > 0
        ? `Nothing you can decide. ${otherCount} proposal(s) await a different role.`
        : "Nothing awaiting approval.",
    );
    return;
  }

  for (const row of decidable) {
    const preview = (row.preview ?? {}) as Record<string, unknown>;
    const summary =
      typeof preview.summary === "string" ? preview.summary : JSON.stringify(preview).slice(0, 400);
    await sendApprovalCard(
      chatId,
      row.id,
      [
        `<b>${escapeHtml(String(row.action_type))}</b>`,
        escapeHtml(summary),
        `<i>requires ${escapeHtml(String(row.required_role))}</i>`,
      ].join("\n"),
    );
  }
  if (otherCount > 0) {
    await sendMessage(chatId, `${otherCount} more proposal(s) await a different role.`);
  }
}

async function showCost(chatId: number | string): Promise<void> {
  const spent = await todaysCost();
  const cap = (await getPolicyValue<number>("daily_cost_cap_usd")) ?? 0;
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  await sendMessage(
    chatId,
    cap > 0
      ? `AI spend today: <b>$${spent.toFixed(4)}</b> of $${cap.toFixed(2)} (${pct}%).`
      : `AI spend today: <b>$${spent.toFixed(4)}</b> (no cap configured).`,
  );
}

async function showStatus(chatId: number | string): Promise<void> {
  const db = getAdminClient();

  const { data: beats } = await db
    .from("hermes_policy")
    .select("key, updated_at")
    .like("key", "heartbeat:%");

  const { data: jobs } = await db
    .from("hermes_job_runs")
    .select("job_name, status, started_at, outcome")
    .order("started_at", { ascending: false })
    .limit(5);

  const enabled = await getPolicyValue<boolean>("enabled");

  const lines = [`<b>Status</b> — ${enabled === false ? "⏸ PAUSED" : "▶️ running"}`, "", "<b>Loops</b>"];
  if (!beats?.length) {
    lines.push("• no heartbeats recorded yet");
  } else {
    for (const b of beats) {
      const mins = ageMinutes(b.updated_at);
      const name = String(b.key).replace("heartbeat:", "");
      lines.push(`• ${escapeHtml(name)} — ${mins === null ? "unknown" : `${mins}m ago`}`);
    }
  }

  lines.push("", "<b>Recent jobs</b>");
  if (!jobs?.length) {
    lines.push("• none yet");
  } else {
    for (const j of jobs) {
      const icon = j.status === "success" ? "✅" : j.status === "running" ? "⏳" : "❌";
      lines.push(`${icon} ${escapeHtml(String(j.job_name))} — ${escapeHtml(String(j.outcome ?? j.status))}`);
    }
  }

  await sendMessage(chatId, lines.join("\n"));
}

export async function handleCommand(ctx: CommandContext): Promise<boolean> {
  const { command, chatId, role } = ctx;

  switch (command) {
    case "/help":
    case "/start":
      await sendMessage(chatId, HELP);
      return true;

    case "/brief": {
      const { runMorningBrief } = await import("../jobs/morning-brief.js");
      await sendMessage(chatId, await runMorningBrief());
      return true;
    }

    case "/compliance": {
      const { runComplianceWatch } = await import("../jobs/compliance-watch.js");
      await sendMessage(chatId, await runComplianceWatch());
      return true;
    }

    case "/balances":
      await showBalances(chatId);
      return true;

    case "/approvals":
      await showApprovals(chatId, role);
      return true;

    case "/cost":
      await showCost(chatId);
      return true;

    case "/status":
      await showStatus(chatId);
      return true;

    case "/pause": {
      const { setPolicyValue } = await import("../lib/policy-kv.js");
      await setPolicyValue("enabled", false, "kill switch, set from Telegram");
      await sendMessage(chatId, "⏸ Paused. Scheduled jobs will not run until /resume.");
      return true;
    }

    case "/resume": {
      const { setPolicyValue } = await import("../lib/policy-kv.js");
      await setPolicyValue("enabled", true, "kill switch, set from Telegram");
      await sendMessage(chatId, "▶️ Resumed.");
      return true;
    }

    default:
      return false;
  }
}
