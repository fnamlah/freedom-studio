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
  // Setting the studio up (031).
  hermes_propose_operator: "upsert_operator",
  hermes_propose_platform: "upsert_platform",
  hermes_propose_account: "upsert_account",
  hermes_propose_assignment: "upsert_assignment",
  hermes_propose_archive: "set_status",
  // super_admin only — `specsForRole` reads that off the policy, so a manager
  // is never even offered these two.
  hermes_propose_scheme: "upsert_scheme",
  hermes_propose_rate_card: "set_rate_card",
  hermes_propose_approve_payout: "approve_payout",
  // Full access (032): the last portal-only actions, now conversational.
  hermes_propose_payout: "create_payout",
  hermes_propose_mark_paid: "mark_payout_paid",
  hermes_propose_cancel_payout: "cancel_payout",
  hermes_propose_delete_document: "delete_document",
  // Hard deletion of entities — a separate action from the manager's
  // day-to-day delete_record, so policy.ts holds it to super_admin.
  hermes_propose_delete_entity: "delete_entity",
  hermes_propose_close_period: "close_period",
  hermes_propose_snapshot_forecast: "snapshot_forecast",
  // A Telegram attachment becomes a compliance document (033).
  hermes_propose_upload_document: "upload_document",
};

/**
 * Tool → egress projection key in the app redactor. Defaults to the tool's
 * own name; named here when a tool reuses an app projection (same rows, same
 * fields — a second, drifting copy would be worse than none). The governance
 * suite iterates THIS map, so an unregistered projection is a failing test
 * before it is a runtime throw.
 */
export const TOOL_PROJECTION: Record<string, string> = {
  hermes_balances: "payee_balances",
  hermes_search: "semantic_search",
  hermes_earnings: "earnings_monthly",
  hermes_payout_history: "payout_history",
  hermes_ledger: "payee_statement",
  hermes_forecast: "forecast",
};

/** The projection a read tool's rows leave through. */
export function projectionFor(tool: string): string {
  return TOOL_PROJECTION[tool] ?? tool;
}

/**
 * Which payload field names THE ENTITY BEING CHANGED, per action — the sole
 * source of supersede keys.
 *
 * An adversarial review killed the previous design twice. A generic scan over
 * "any id-looking field" first collided two DIFFERENT payouts (fixed by entity
 * keys), then resurfaced through creates: an upload payload carries `model_id`,
 * so two document uploads for the same model superseded each other — the
 * second passport silently cancelled the first. The rule that survives both:
 * only an action's own TARGET id may key a supersede, and a CREATE has no
 * target id — it never supersedes anything. Absence from this map IS the
 * create case: `upload_document` and every propose-new path stay out, and the
 * upsert entries key on the row id that only an UPDATE payload carries.
 */
export const SUPERSEDE_ID_FIELD: Record<string, string> = {
  upsert_model: "model_id",
  upsert_operator: "operator_id",
  upsert_platform: "platform_id",
  upsert_account: "account_id",
  upsert_assignment: "assignment_id",
  upsert_scheme: "scheme_id",
  set_rate_card: "scheme_id",
  set_status: "record_id",
  delete_record: "record_id",
  delete_entity: "record_id",
  update_document: "document_id",
  delete_document: "document_id",
  read_compliance_document: "document_id",
  approve_payout: "payout_id",
  mark_payout_paid: "payout_id",
  cancel_payout: "payout_id",
};

/** The entity a proposal targets, or undefined for creates (never supersede). */
export function supersedeKeyFor(
  actionType: string,
  payload: Record<string, unknown>,
): string | undefined {
  const field = SUPERSEDE_ID_FIELD[actionType];
  if (!field) return undefined;
  const v = payload[field];
  return typeof v === "string" && v ? `${actionType}:${field}:${v}` : undefined;
}

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
          telegram_username: { type: "string", description: "Her Telegram handle, with or without @." },
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
          started_on: { type: "string", description: "YYYY-MM-DD, to identify a work session." },
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

/* --------------------------------------------------------- setup surface --- */

const SETUP_READ_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_team",
      description:
        "The studio's team — operators, coaches and team leaders — with who each one works with and their share of that model's team pool. Use for 'who is on the team', 'who works with X', or before changing an assignment.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: only this model's team." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_platforms",
      description:
        "The platforms the studio works with and the accounts on them. Use for 'which platforms do we use', 'what accounts does X have', or before adding an account.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: only this model's accounts." },
        },
        additionalProperties: false,
      },
    },
  },
];

const SETUP_PROPOSE_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_propose_operator",
      description:
        "Propose adding a team member — an operator, coach or team leader — or changing one's details. Sends an Approve card. To change someone, pass their current name. To retire them, use hermes_propose_archive instead.",
      parameters: {
        type: "object",
        properties: {
          person: { type: "string", description: "Existing name when changing someone." },
          display_name: { type: "string", description: "New or changed display name." },
          legal_name: { type: "string", description: "Full legal name." },
          staff_role: {
            type: "string",
            enum: ["operator", "coach", "team_leader"],
            description: "What kind of team member. Defaults to operator.",
          },
          email: { type: "string" },
          phone: { type: "string" },
          country: { type: "string", description: "Two-letter country code, e.g. PL." },
          start_date: { type: "string", description: "YYYY-MM-DD." },
          telegram_username: { type: "string", description: "Their Telegram handle, with or without @." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_platform",
      description:
        "Propose adding a platform the studio works with, or renaming one. Sends an Approve card. To retire a platform, use hermes_propose_archive.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", description: "Existing platform name when changing one." },
          name: { type: "string", description: "New or changed name." },
          website_url: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_account",
      description:
        "Propose adding a model's account on a platform, or changing an existing account's username or platform fee. Sends an Approve card. An existing account cannot be moved to another model or platform — add a new one instead.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "The model's stage name." },
          platform: { type: "string", description: "The platform name." },
          username: { type: "string", description: "The account handle." },
          platform_fee_percent: { type: "number", description: "The platform's cut, 0-100." },
          existing_username: {
            type: "string",
            description: "Pass when CHANGING an account: its current username.",
          },
        },
        required: ["model", "platform"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_assignment",
      description:
        "Propose attaching a team member to a model for a date range, with their share of that model's team pool, or changing an existing attachment. Shares across everyone on one model cannot exceed 100% on any date. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          person: { type: "string", description: "The team member's name." },
          model: { type: "string", description: "The model's stage name." },
          pool_share_percent: {
            type: "number",
            description: "Their weight in the model's team pool, 0-100. Defaults to 100.",
          },
          assigned_from: { type: "string", description: "Start date, YYYY-MM-DD." },
          assigned_to: { type: "string", description: "Optional end date, YYYY-MM-DD." },
          change_existing: {
            type: "boolean",
            description: "True to edit their current attachment rather than add one.",
          },
        },
        required: ["person", "model"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_archive",
      description:
        "Propose retiring a model, team member, platform or account — the studio archives rather than deletes, so history and past earnings stay intact. Sends an Approve card. Use this whenever someone asks to remove or delete one of these.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["model", "operator", "platform", "account"],
            description: "What to retire.",
          },
          name: { type: "string", description: "Their name, or the model's name for an account." },
          platform: { type: "string", description: "For an account: which platform." },
          status: {
            type: "string",
            enum: ["active", "inactive", "on_leave", "terminated", "suspended", "closed"],
            description: "The new state. Defaults to retiring them.",
          },
        },
        required: ["kind", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_scheme",
      description:
        "Propose a commission scheme — how net earnings split between the model, the team pool and the studio. The three percentages must total 100. Leave model and account empty for the studio-wide default. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: a scheme for one model." },
          platform: { type: "string", description: "With model: a scheme for one account." },
          model_percent: { type: "number" },
          operator_percent: { type: "number", description: "The TEAM pool, split among the team." },
          studio_percent: { type: "number" },
          effective_from: { type: "string", description: "YYYY-MM-DD." },
          effective_to: { type: "string", description: "Optional end date, YYYY-MM-DD." },
          change_existing: {
            type: "boolean",
            description: "True to edit the scheme already covering that scope.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_rate_card",
      description:
        "Propose replacing a scheme's rate card: the percentage each role earns at each income bracket. Replaces the whole card, so send every bracket. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Whose scheme. Omit for the studio default." },
          rates: {
            type: "array",
            description: "Every bracket for every role.",
            items: {
              type: "object",
              properties: {
                party: {
                  type: "string",
                  enum: [
                    "model_with_operator",
                    "model_with_coach",
                    "model_independent",
                    "operator",
                    "coach",
                    "team_leader",
                  ],
                },
                min_amount: { type: "number", description: "Bracket floor in dollars." },
                percent: { type: "number" },
              },
              required: ["party", "min_amount", "percent"],
              additionalProperties: false,
            },
          },
        },
        required: ["rates"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_approve_payout",
      description:
        "Propose approving a payout that is waiting. Sends a card naming the payee, the amount, the period and who created it. Approving authorises it only — releasing the money is still a separate step in the app.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string", description: "The model or team member being paid." },
          period_end: { type: "string", description: "Optional: which period, YYYY-MM-DD." },
        },
        required: ["payee"],
        additionalProperties: false,
      },
    },
  },
];

/* ------------------------------------------------------- full access (032) --- */

const FULL_READ_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_earnings",
      description:
        "Studio-wide earnings, month by month, per model and platform. Use for 'how did the studio do', 'earnings this month', or comparisons across models.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: only this model." },
          months: { type: "number", description: "How many recent months. Default 3." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_sessions",
      description:
        "Hours worked and session counts, month by month. Use for 'who worked the most', 'hours in July'.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Optional: only this model." },
          months: { type: "number", description: "How many recent months. Default 3." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_expenses",
      description:
        "The studio's recorded expenses: date, vendor, amount, category. Use for 'what did we spend', 'expenses in July'.",
      parameters: {
        type: "object",
        properties: {
          months: { type: "number", description: "How many recent months. Default 3." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_payout_history",
      description:
        "Payouts — pending, approved, paid and cancelled — with payee, period and amount. Use for 'what payouts are waiting', 'was Лилия paid for July'.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string", description: "Optional: one model or team member." },
          status: {
            type: "string",
            enum: ["pending", "approved", "paid", "cancelled"],
            description: "Optional: only this status.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_ledger",
      description:
        "One person's ledger statement: every credit, deduction and settlement with a running balance. Read-only — the ledger itself can never be edited or deleted. Use for 'why is her balance X', 'show Лилия's statement'.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string", description: "The model or team member." },
          from: { type: "string", description: "Start date YYYY-MM-DD. Default: 3 months ago." },
          to: { type: "string", description: "End date YYYY-MM-DD. Default: today." },
        },
        required: ["payee"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_forecast",
      description:
        "The earnings forecast for coming months, plus how accurate past forecasts proved. Use for 'what do we expect next month'.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_schemes",
      description:
        "Every commission scheme: its scope (studio default, one model, or one account), the three-way split, effective dates, and whether a per-role rate card is attached.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_person_details",
      description:
        "One person's full details — legal name, date of birth, contacts, country, status. Pass include_payment_details true ONLY when asked specifically about payment or bank details.",
      parameters: {
        type: "object",
        properties: {
          person: { type: "string", description: "The model's stage name or team member's name." },
          include_payment_details: {
            type: "boolean",
            description: "True only when payment/bank details were explicitly asked for.",
          },
        },
        required: ["person"],
        additionalProperties: false,
      },
    },
  },
];

const FULL_PROPOSE_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "hermes_propose_payout",
      description:
        "Propose creating a payout for a model or team member — the amount owed for a period. It lands as pending and still needs approval. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string", description: "Who is being paid." },
          period_start: { type: "string", description: "YYYY-MM-DD." },
          period_end: { type: "string", description: "YYYY-MM-DD." },
          net_amount: { type: "number", description: "What they receive." },
          gross_amount: { type: "number" },
          deductions: { type: "number" },
          currency: { type: "string", description: "Default USD." },
        },
        required: ["payee", "period_start", "period_end", "net_amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_mark_paid",
      description:
        "Propose recording an APPROVED payout as paid — money released. This posts a permanent settlement entry to the ledger and cannot be undone, only adjusted. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string" },
          period_end: { type: "string", description: "Which period, YYYY-MM-DD, when several." },
          reference: { type: "string", description: "Optional payment reference." },
          payment_method: { type: "string", description: "Optional: how it was paid." },
        },
        required: ["payee"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_cancel_payout",
      description:
        "Propose cancelling a pending or approved payout. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          payee: { type: "string" },
          period_end: { type: "string", description: "Which period, YYYY-MM-DD, when several." },
        },
        required: ["payee"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_delete_document",
      description:
        "Propose PERMANENTLY deleting a compliance document — the record and the stored file both. Sends an Approve card naming whose document it is.",
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
  {
    type: "function",
    function: {
      name: "hermes_propose_delete_entity",
      description:
        "Propose PERMANENTLY deleting a model, team member, platform, account, assignment, commission scheme, rate card, or an unpaid payout. Prefer hermes_propose_archive — use this only when someone explicitly asks to permanently delete. Anything with posted money history is refused with the reason; the ledger itself can never be deleted.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "model",
              "operator",
              "platform",
              "account",
              "assignment",
              "scheme",
              "rate_card",
              "payout",
            ],
          },
          name: {
            type: "string",
            description:
              "The entity's name: the person, platform, or (for account/payout) the model/payee.",
          },
          model: { type: "string", description: "For assignment: which model. For scheme/rate_card: whose." },
          platform: { type: "string", description: "For account: which platform." },
          period_end: { type: "string", description: "For payout: which period, YYYY-MM-DD." },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_close_period",
      description:
        "Propose closing an earnings period: posts every model's and team member's share of that period's earnings to the ledger. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          period_start: { type: "string", description: "YYYY-MM-DD." },
          period_end: { type: "string", description: "YYYY-MM-DD." },
        },
        required: ["period_start", "period_end"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hermes_propose_snapshot_forecast",
      description:
        "Propose saving a forecast snapshot, so future accuracy can be measured against it. Sends an Approve card.",
      parameters: {
        type: "object",
        properties: {
          months_ahead: { type: "number", description: "How many months forward. Default 3." },
        },
        additionalProperties: false,
      },
    },
  },
];

const DOCUMENT_FLOW_TOOLS: { reads: ToolSpec[]; proposes: ToolSpec[] } = {
  reads: [
    {
      type: "function",
      function: {
        name: "hermes_search",
        description:
          "Semantic search across the studio's indexed knowledge: notes, document metadata, platform info. Use when a plain listing tool doesn't answer — 'which contract mentions X', 'notes about her schedule'. Returns snippets with similarity scores.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural-language search query." },
            top_k: { type: "number", description: "How many matches. Default 5, max 10." },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
  ],
  proposes: [
    {
      type: "function",
      function: {
        name: "hermes_propose_upload_document",
        description:
          "Save the file attached to this chat as a compliance document for a model. Use when someone sends a photo/scan/PDF and says whose document it is. Sends an Approve card; the file is stored only after the tap. If no file is attached, ask them to send it.",
        parameters: {
          type: "object",
          properties: {
            model: { type: "string", description: "Whose document — the model's stage name." },
            title: { type: "string", description: "A short title, e.g. 'Passport 2026'. Derive one from the document type and person if not stated." },
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
              description: "What kind of document. Default other.",
            },
            issued_date: { type: "string", description: "Optional, YYYY-MM-DD." },
            expires_at: { type: "string", description: "Optional expiry, YYYY-MM-DD." },
          },
          required: ["model", "title"],
          additionalProperties: false,
        },
      },
    },
  ],
};

READ_TOOLS.push(...SETUP_READ_TOOLS, ...FULL_READ_TOOLS, ...DOCUMENT_FLOW_TOOLS.reads);
PROPOSE_TOOLS.push(...SETUP_PROPOSE_TOOLS, ...FULL_PROPOSE_TOOLS, ...DOCUMENT_FLOW_TOOLS.proposes);

TOOL_SPECS.push(...READ_TOOLS, ...PROPOSE_TOOLS);

/**
 * Which command's role gate each read tool inherits.
 *
 * NOT all `/balances`. An adversarial review caught that mapping handing the
 * FINANCE role every compliance document: `commandAllowed` returns true for
 * finance on `/balances`, but 008 denies finance the `documents` table
 * ENTIRELY — "a deliberate least-privilege stance". The bot would have served
 * passport titles, types, expiry dates and the AI's extracts of their contents
 * to a role with no path to a single such row in the app.
 *
 * Earnings and terms are genuinely fine for finance — it holds explicit SELECT
 * policies on `earnings`, `work_sessions`, `commission_schemes` and
 * `commission_rates` — which is exactly what made the documents case a silent
 * outlier rather than an obvious one. So each tool now names the surface it
 * actually reads.
 */
const READ_TOOL_COMMAND: Record<string, string> = {
  hermes_model_earnings: "/balances",
  hermes_model_terms: "/balances",
  // SA/MGR only, mirroring `documents_admin_all` in 008.
  hermes_documents: "/documents",
  // The team and the platform list are SA/MGR, like the entities themselves:
  // 008 gives finance no policy on `operators` or `platforms` at all, so
  // mapping these to /balances would repeat exactly the mistake the comment
  // above records.
  hermes_team: "/documents",
  hermes_platforms: "/documents",
  // Money reads go where finance already is: 008 grants finance SELECT on
  // earnings, work_sessions, payouts, ledger_entries and schemes.
  hermes_earnings: "/balances",
  hermes_sessions: "/balances",
  hermes_payout_history: "/balances",
  hermes_ledger: "/balances",
  hermes_forecast: "/balances",
  hermes_schemes: "/balances",
  // Expenses have NO finance policy in 008 (SA/MGR admin_all only), and person
  // details are identity data — both stay SA/MGR.
  hermes_expenses: "/documents",
  hermes_person_details: "/documents",
  // Search snippets can carry note and document text — SA/MGR, like the shelf.
  hermes_search: "/documents",
};

for (const spec of READ_TOOLS) {
  TOOL_COMMAND[spec.function.name] = READ_TOOL_COMMAND[spec.function.name] ?? "/documents";
}
for (const spec of PROPOSE_TOOLS) TOOL_COMMAND[spec.function.name] = "/propose";
