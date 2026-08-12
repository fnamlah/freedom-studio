import { roleSatisfies } from "../governance/policy.js";
import { todaysCost } from "../lib/cost.js";
import { hermesDict, money as fmtMoney, type Locale } from "../lib/i18n.js";
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
 * Every reply is rendered in the ASKING PERSON's language (`ctx.locale`, read
 * from their profile), not in a deployment-wide language.
 *
 * Returns true when the command was recognised and answered.
 */

export interface CommandContext {
  command: string;
  chatId: number | string;
  profileId: string;
  role: string;
  /** The asking person's language — every reply below is rendered in it. */
  locale: Locale;
  text: string;
}

function help(locale: Locale): string {
  const h = hermesDict(locale);
  return [
    `<b>${h.helpTitle}</b>`,
    "",
    `/brief — ${h.helpBrief}`,
    `/compliance — ${h.helpCompliance}`,
    `/balances — ${h.helpBalances}`,
    `/approvals — ${h.helpApprovals}`,
    `/cost — ${h.helpCost}`,
    `/status — ${h.helpStatus}`,
    `/pause, /resume — ${h.helpPause}`,
    `/help — ${h.helpHelp}`,
  ].join("\n");
}

function ageMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60_000);
}

async function showBalances(chatId: number | string, locale: Locale): Promise<void> {
  const h = hermesDict(locale);
  const { data, error } = await getAdminClient()
    .from("v_payee_balances")
    .select("payee_type, display_name, balance")
    .gt("balance", 0)
    .order("balance", { ascending: false })
    .limit(15);

  if (error) {
    await sendMessage(chatId, h.balancesError(escapeHtml(error.message)));
    return;
  }
  if (!data?.length) {
    await sendMessage(chatId, h.balancesEmpty);
    return;
  }

  const lines = data.map((r) => {
    const type = r.payee_type ? (h.payee[r.payee_type] ?? String(r.payee_type)) : "—";
    return `• ${escapeHtml(String(r.display_name ?? "—"))} (${escapeHtml(type)}) — <b>${fmtMoney(
      r.balance,
      locale,
    )}</b>`;
  });
  await sendMessage(chatId, [`<b>${h.balancesTitle}</b>`, ...lines].join("\n"), { html: true });
}

async function showApprovals(
  chatId: number | string,
  role: string,
  locale: Locale,
): Promise<void> {
  const h = hermesDict(locale);
  const { data, error } = await getAdminClient()
    .from("hermes_approvals")
    .select("id, action_type, required_role, preview, created_at, expires_at")
    .eq("state", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    await sendMessage(chatId, h.approvalsError(escapeHtml(error.message)));
    return;
  }

  // Cards only for proposals this person could actually decide. Sending a
  // manager a finance approval card would render buttons that can only fail.
  const decidable = (data ?? []).filter((row) => roleSatisfies(role, String(row.required_role)));
  const otherCount = (data ?? []).length - decidable.length;

  if (decidable.length === 0) {
    await sendMessage(
      chatId,
      otherCount > 0 ? h.approvalsNoneForYou(otherCount) : h.approvalsEmpty,
    );
    return;
  }

  for (const row of decidable) {
    const preview = (row.preview ?? {}) as Record<string, unknown>;
    // Proposals written since 019 carry both languages; older rows have only
    // the original `summary`, so fall back to it rather than showing nothing.
    const localized = preview[`summary_${locale}`];
    const summary =
      typeof localized === "string"
        ? localized
        : typeof preview.summary === "string"
          ? preview.summary
          : JSON.stringify(preview).slice(0, 400);
    const action = h.action[String(row.action_type)] ?? String(row.action_type);
    const required = h.role[String(row.required_role)] ?? String(row.required_role);
    await sendApprovalCard(
      chatId,
      row.id,
      [
        `<b>${escapeHtml(action)}</b>`,
        escapeHtml(summary),
        `<i>${escapeHtml(h.approvalRequires(required))}</i>`,
      ].join("\n"),
      locale,
    );
  }
  if (otherCount > 0) {
    await sendMessage(chatId, h.approvalsMoreForOthers(otherCount));
  }
}

async function showCost(chatId: number | string, locale: Locale): Promise<void> {
  const h = hermesDict(locale);
  const spent = await todaysCost();
  const cap = (await getPolicyValue<number>("daily_cost_cap_usd")) ?? 0;
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  await sendMessage(
    chatId,
    cap > 0
      ? h.costWithCap(fmtMoney(spent, locale), fmtMoney(cap, locale), pct)
      : h.costNoCap(fmtMoney(spent, locale)),
    { html: true },
  );
}

async function showStatus(chatId: number | string, locale: Locale): Promise<void> {
  const h = hermesDict(locale);
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

  const lines = [
    `<b>${h.statusTitle}</b> — ${enabled === false ? h.statusPaused : h.statusRunning}`,
    "",
    `<b>${h.statusLoops}</b>`,
  ];
  if (!beats?.length) {
    lines.push(h.statusNoHeartbeats);
  } else {
    for (const b of beats) {
      const mins = ageMinutes(b.updated_at);
      const name = String(b.key).replace("heartbeat:", "");
      lines.push(
        `• ${escapeHtml(name)} — ${mins === null ? h.statusUnknown : h.statusMinutesAgo(mins)}`,
      );
    }
  }

  lines.push("", `<b>${h.statusRecentJobs}</b>`);
  if (!jobs?.length) {
    lines.push(h.statusNoJobs);
  } else {
    for (const j of jobs) {
      const icon = j.status === "success" ? "✅" : j.status === "running" ? "⏳" : "❌";
      // `outcome` is the job's own diary line, written for whoever debugs the
      // worker — it stays in the language the job wrote it in.
      lines.push(
        `${icon} ${escapeHtml(String(j.job_name))} — ${escapeHtml(String(j.outcome ?? j.status))}`,
      );
    }
  }

  await sendMessage(chatId, lines.join("\n"), { html: true });
}

export async function handleCommand(ctx: CommandContext): Promise<boolean> {
  const { command, chatId, role, locale } = ctx;
  const h = hermesDict(locale);

  switch (command) {
    case "/help":
    case "/start":
      await sendMessage(chatId, help(locale), { html: true });
      return true;

    case "/brief": {
      // Runs the job, which broadcasts to every paired chat in each reader's
      // own language; the return value is the log line, not the message.
      const { runMorningBrief } = await import("../jobs/morning-brief.js");
      await runMorningBrief();
      return true;
    }

    case "/compliance": {
      const { runComplianceWatch } = await import("../jobs/compliance-watch.js");
      await runComplianceWatch();
      return true;
    }

    case "/balances":
      await showBalances(chatId, locale);
      return true;

    case "/approvals":
      await showApprovals(chatId, role, locale);
      return true;

    case "/cost":
      await showCost(chatId, locale);
      return true;

    case "/status":
      await showStatus(chatId, locale);
      return true;

    case "/pause": {
      const { setPolicyValue } = await import("../lib/policy-kv.js");
      await setPolicyValue("enabled", false, "kill switch, set from Telegram");
      await sendMessage(chatId, h.paused);
      return true;
    }

    case "/resume": {
      const { setPolicyValue } = await import("../lib/policy-kv.js");
      await setPolicyValue("enabled", true, "kill switch, set from Telegram");
      await sendMessage(chatId, h.resumed);
      return true;
    }

    default:
      return false;
  }
}
