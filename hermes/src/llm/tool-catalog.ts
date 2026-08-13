import type { ToolSpec } from "./provider.js";

/**
 * What Hermes may look up while holding a conversation.
 *
 * THE CENTRAL RULE: these tools read EXACTLY what the slash commands already
 * read, and nothing else. Making the bot chatty must not widen what it can
 * see. That is what lets this ship without re-opening the question the app
 * settles with RLS — the worker holds a service-role client with no row-level
 * safety net, so the only honest way to bound it is to bind each tool to a
 * query a command already performs, and to gate the tool by the same role
 * matrix that gates that command (`access.ts` → `commandAllowed`).
 *
 * Consequences, stated plainly:
 *   - No tool takes free-form filters, ids, or anything resembling a query. A
 *     model cannot ask for "the row where …"; it picks a reader, and the
 *     reader's shape is fixed here.
 *   - No tool writes. Approving remains a button press that goes through
 *     `decide_approval`, which re-checks the actor's role in the database.
 *   - Every result leaves through `redactToolResult`, which is fail-closed:
 *     a tool with no registered projection throws rather than serializing.
 *
 * Adding a tool here is a security change: it needs a projection in the app's
 * redactor and a role in `TOOL_ROLES` below, or it will not run at all.
 */

/** Which command each tool mirrors — the role gate is that command's gate. */
export const TOOL_COMMAND: Record<string, string> = {
  hermes_balances: "/balances",
  hermes_approvals: "/approvals",
  hermes_compliance: "/compliance",
  hermes_cost: "/cost",
  hermes_status: "/status",
};

export type HermesToolName = keyof typeof TOOL_COMMAND;

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_balances",
      description:
        "Outstanding balances owed to models and operators — who is owed money and how much. Use for questions about what the studio owes, who is unpaid, or the biggest balances.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_approvals",
      description:
        "Proposals Hermes has raised that are waiting for a human decision. Use for questions about what needs approving, what is pending, or what Hermes is waiting on.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_compliance",
      description:
        "Counts of compliance documents by state (valid, expiring soon, expired). Use for questions about document expiry, compliance health, or paperwork that needs renewing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_cost",
      description:
        "What the studio's AI usage has cost today against the daily cap. Use for questions about AI spend or the cost cap.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_status",
      description:
        "Whether Hermes' background loops are running, when each last reported, and how recent jobs finished. Use for questions about whether the agent is working, paused, or stuck.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

/** The specs this role may be shown. A tool it cannot use is never offered. */
export function specsForRole(
  role: string,
  commandAllowed: (role: string, command: string) => boolean,
): ToolSpec[] {
  return TOOL_SPECS.filter((s) =>
    commandAllowed(role, TOOL_COMMAND[s.function.name] ?? "/help"),
  );
}
