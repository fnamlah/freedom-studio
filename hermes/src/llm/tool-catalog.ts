import { resolvePolicy, roleSatisfies } from "../governance/policy.js";
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

/**
 * The specs this role may be shown. A tool it cannot use is never offered.
 *
 * Reads are gated by the command they mirror. A `propose_*` tool is gated by
 * whether this person could actually DECIDE the action it would raise — there
 * is no point offering someone a card only another role can approve, and
 * `roleSatisfies` is the same check `decide_approval` performs in the database.
 */
export function specsForRole(
  role: string,
  commandAllowed: (role: string, command: string) => boolean,
): ToolSpec[] {
  return TOOL_SPECS.filter((s) => {
    const action = PROPOSE_ACTION[s.function.name];
    if (action) {
      const policy = resolvePolicy(action);
      return policy.tier === "approval" && roleSatisfies(role, policy.requiredRole ?? "super_admin");
    }
    return commandAllowed(role, TOOL_COMMAND[s.function.name] ?? "/help");
  });
}

/* ======================================================================== *
 * The widened surface (029/030), by owner decision: per-model detail, the
 * terms a model works under, the document shelf, and — behind a mandatory
 * Approve tap — creating, changing and deleting records.
 *
 * Two rules hold across all of it:
 *   * NAMES, NEVER IDS. Every tool takes a stage name or a title; `resolve.ts`
 *     turns it into an id and refuses ambiguity rather than guessing.
 *   * NOTHING HERE WRITES. The `propose_*` tools queue an approval and send a
 *     card. Execution happens only after a human taps, through
 *     `decide_approval` — which re-checks their role in the database — and the
 *     executors then impersonate that person so the row is theirs.
 * ======================================================================== */

/** Tools that propose a write. Each maps to an ACTION_POLICIES entry. */
export const PROPOSE_ACTION: Record<string, string> = {
  hermes_propose_earning: "record_earning",
  hermes_propose_session: "record_session",
  hermes_propose_expense: "record_expense",
  hermes_propose_model: "upsert_model",
  hermes_propose_document_update: "update_document",
  hermes_propose_delete: "delete_record",
  hermes_propose_read_document: "read_compliance_document",
};

const READ_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_model_earnings",
      description:
        "One model's earnings and hours, month by month. Use for questions about how much a specific person made or worked, e.g. 'how did Лилия do in July?'.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "The model's stage name." },
          months: { type: "number", description: "How many recent months. Default 3." },
        },
        required: ["model"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_model_terms",
      description:
        "The commission terms a model works under: which scheme applies, the per-role rate card by income bracket, and who is on her team. Use for 'what percentage does X get' or 'who works with X'.",
      parameters: {
        type: "object",
        properties: { model: { type: "string", description: "The model's stage name." } },
        required: ["model"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_documents",
      description:
        "The document shelf: compliance documents and Library files, with what the AI already read out of each (summary and key figures) and when they expire. Use for 'what documents do we have for X', 'what expires soon', 'what was in that statement'.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: limit to one model's documents." },
          search: { type: "string", description: "Optional: match a title or file name." },
          expiring: { type: "boolean", description: "Optional: only expiring or expired." },
        },
        additionalProperties: false,
      },
    },
  },
];

const PROPOSE_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_propose_earning",
      description:
        "Propose recording an earning. Sends an Approve card; nothing is written until the person taps it. Use when asked to record, add or log a payout/statement figure.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string" },
          platform: { type: "string", description: "Needed when the model has several accounts." },
          period_start: { type: "string", description: "YYYY-MM-DD" },
          period_end: { type: "string", description: "YYYY-MM-DD" },
          gross_amount: { type: "number" },
          fee_amount: { type: "number" },
          net_amount: { type: "number" },
        },
        required: ["model", "period_start", "period_end", "gross_amount", "net_amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_session",
      description:
        "Propose recording a work session (a shift). Sends an Approve card. Omit ended_at for a session still running.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string" },
          platform: { type: "string" },
          started_at: { type: "string", description: "YYYY-MM-DDTHH:MM" },
          ended_at: { type: "string", description: "YYYY-MM-DDTHH:MM" },
          gross_earnings: { type: "number" },
          notes: { type: "string" },
        },
        required: ["model", "started_at"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_expense",
      description: "Propose recording a studio cost (rent, equipment, subscriptions). Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          incurred_on: { type: "string", description: "YYYY-MM-DD" },
          vendor: { type: "string" },
          amount: { type: "number" },
          description: { type: "string" },
          category: { type: "string" },
        },
        required: ["incurred_on", "vendor", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_model",
      description:
        "Propose adding a new model, or changing an existing one's details or status. Sends an Approve card. To change someone, pass her current stage name.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Existing stage name when changing someone." },
          stage_name: { type: "string", description: "New or changed stage name." },
          legal_name: { type: "string", description: "Required for a NEW model." },
          date_of_birth: { type: "string", description: "YYYY-MM-DD. Required for a NEW model." },
          commission_percent: { type: "number" },
          status: { type: "string", enum: ["active", "inactive", "on_leave", "terminated"] },
          country: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_document_update",
      description:
        "Propose correcting a document's details — its title, type, issue date or expiry. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          document: { type: "string", description: "The document title." },
          model: { type: "string", description: "Optional: whose document." },
          title: { type: "string" },
          doc_type: {
            type: "string",
            enum: [
              "government_id",
              "passport",
              "contract",
              "model_release",
              "consent_form",
              "tax_form",
              "other",
            ],
          },
          issued_date: { type: "string", description: "YYYY-MM-DD" },
          expires_at: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["document"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_delete",
      description:
        "Propose deleting one record. Sends an Approve card naming exactly what would go. Only earnings, work sessions and expenses can be deleted — ledger entries and the audit log cannot be removed by anyone.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["earning", "work_session", "expense"] },
          model: { type: "string", description: "Whose record, for earnings and sessions." },
          period_start: { type: "string", description: "YYYY-MM-DD, to identify an earning." },
          vendor: { type: "string", description: "To identify an expense." },
          incurred_on: { type: "string", description: "YYYY-MM-DD, to identify an expense." },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_read_document",
      description:
        "Propose sending a compliance document's CONTENTS (a passport, ID or contract scan) to the AI provider so it can be read. Sends a card that names the document and that it is identity data; approving records consent and is auditable. Only needed for documents not already readable — check hermes_documents first.",
      parameters: {
        type: "object",
        properties: {
          document: { type: "string", description: "The document title." },
          model: { type: "string", description: "Optional: whose document." },
        },
        required: ["document"],
        additionalProperties: false,
      },
    },
  },
];

TOOL_SPECS.push(...READ_TOOLS, ...PROPOSE_TOOLS);

// Reads follow the surface they extend; writes are manager-and-above, matching
// the ACTION_POLICIES `requiredRole` on every proposed action.
for (const spec of READ_TOOLS) TOOL_COMMAND[spec.function.name] = "/balances";
for (const spec of PROPOSE_TOOLS) TOOL_COMMAND[spec.function.name] = "/propose";
