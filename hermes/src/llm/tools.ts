import { roleSatisfies } from "../governance/policy.js";
import { todaysCost } from "../lib/cost.js";
import { getPolicyValue } from "../lib/policy-kv.js";
import { getAdminClient } from "../lib/supabase.js";
import { TOOL_COMMAND } from "./tool-catalog.js";
import { redactToolResult } from "./redact.js";

/**
 * Executing a conversational tool.
 *
 * Split from `tool-catalog.ts` on purpose: the catalog is pure data so the
 * governance suite can assert its properties without booting env or a database
 * — the same reason `telegram/access.ts` is pure. This half needs both, so it
 * stays out of that import graph.
 */

function ageMinutes(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60_000);
}

/**
 * Raise on a failed read instead of returning nothing.
 *
 * PostgREST resolves `{ data: null, error }` rather than rejecting, so a
 * dropped `error` turns a failed query into an empty array — and the model,
 * told to answer only from tools and never invent, states that emptiness as
 * fact: "nobody is owed anything right now" when the balances query actually
 * failed. A false negative about money owed to a performer is indistinguishable
 * from a true one.
 *
 * The slash commands this surface mirrors branch on `error` and say so
 * (commands.ts `balancesError`/`approvalsError`); throwing here is how the
 * conversational path keeps that promise — `converse()` turns a thrown tool
 * error into an `{error}` payload the model can report honestly.
 */
function orThrow<T>(
  tool: string,
  result: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (result.error) throw new Error(`${tool} read failed: ${result.error.message}`);
  return result.data ?? [];
}

/**
 * Run one tool and return its REDACTED rows.
 *
 * `role` is re-checked here even though `specsForRole` already filtered the
 * offer: a model can hallucinate a tool name it was never given, and the
 * offer is a suggestion while this is the gate.
 */
export async function runTool(
  name: string,
  role: string,
  commandAllowed: (role: string, command: string) => boolean,
): Promise<Record<string, unknown>[]> {
  const command = TOOL_COMMAND[name];
  if (!command) throw new Error(`unknown tool: ${name}`);
  if (!commandAllowed(role, command)) throw new Error(`tool ${name} not permitted for ${role}`);

  const db = getAdminClient();

  switch (name) {
    case "hermes_balances": {
      const rows = orThrow(
        name,
        await db
          .from("v_payee_balances")
          .select("payee_type, display_name, balance, currency")
          .gt("balance", 0)
          .order("balance", { ascending: false })
          .limit(15),
      );
      return redactToolResult("payee_balances", rows);
    }

    case "hermes_approvals": {
      const data = orThrow(
        name,
        await db
          .from("hermes_approvals")
          .select("action_type, required_role, preview, created_at, expires_at")
          .eq("state", "pending")
          .order("created_at", { ascending: true })
          .limit(10),
      );
      // Only what this person could actually decide — the same filter the
      // /approvals command applies before rendering a card.
      const decidable = data.filter((r) =>
        roleSatisfies(role, String(r.required_role)),
      );
      // `preview` is free-form JSON written by the worker. Flatten only its
      // summary to a scalar: the projection would drop the object anyway, and
      // an un-summarised proposal is better described than dumped.
      const rows = decidable.map((r) => {
        const preview = (r.preview ?? {}) as Record<string, unknown>;
        const summary =
          typeof preview.summary_en === "string"
            ? preview.summary_en
            : typeof preview.summary === "string"
              ? preview.summary
              : null;
        return {
          action_type: r.action_type,
          required_role: r.required_role,
          summary,
          created_at: r.created_at,
          expires_at: r.expires_at,
        };
      });
      return redactToolResult("hermes_approvals", rows);
    }

    case "hermes_compliance": {
      return redactToolResult("hermes_compliance", orThrow(name, await db.rpc("fn_compliance_counts")));
    }

    case "hermes_cost": {
      const spent = await todaysCost();
      const cap = (await getPolicyValue<number>("daily_cost_cap_usd")) ?? 0;
      return redactToolResult("hermes_cost", [
        { spent_usd: Number(spent.toFixed(4)), cap_usd: cap, currency: "USD" },
      ]);
    }

    case "hermes_status": {
      const beats = orThrow(
        name,
        await db.from("hermes_policy").select("key, updated_at").like("key", "heartbeat:%"),
      );
      const jobs = orThrow(
        name,
        await db
          .from("hermes_job_runs")
          .select("job_name, status, outcome, started_at")
          .order("started_at", { ascending: false })
          .limit(5),
      );
      const enabled = await getPolicyValue<boolean>("enabled");

      const rows = [
        ...beats.map((b) => ({
          kind: "loop",
          name: String(b.key).replace("heartbeat:", ""),
          minutes_ago: ageMinutes(b.updated_at),
          state: enabled === false ? "paused" : "running",
        })),
        ...jobs.map((j) => ({
          kind: "job",
          name: j.job_name,
          state: j.status,
          outcome: j.outcome,
        })),
      ];
      return redactToolResult("hermes_status", rows);
    }

    default:
      throw new Error(`unhandled tool: ${name}`);
  }
}
