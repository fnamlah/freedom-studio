import { env } from "../config/env.js";

/**
 * The scheduler is a table, not a framework.
 *
 * Each job declares WHEN it may run (a UTC hour, optionally a day of week) and
 * whether it costs LLM tokens — the runner skips `usesLlm` jobs once the daily
 * cost cap is spent. Handlers return a string that is logged and stored as the
 * run outcome, so `hermes_job_runs` reads like a diary.
 */

export interface JobGate {
  /** Earliest UTC hour the job may run on its day. */
  hourUtc: number;
  /** 0 = Sunday. Omit for a daily job. */
  dayOfWeek?: number;
}

export interface HermesJob {
  name: string;
  gate: JobGate;
  usesLlm: boolean;
  handler: () => Promise<string | void>;
}

/**
 * A function, not a const, so gates read live env at tick time rather than
 * freezing whatever was set at module load.
 */
export function jobs(): HermesJob[] {
  return [
    {
      name: "morning_brief",
      gate: { hourUtc: env.HERMES_BRIEF_HOUR_UTC },
      usesLlm: true,
      handler: async () => {
        const { runMorningBrief } = await import("../jobs/morning-brief.js");
        return runMorningBrief();
      },
    },
    {
      name: "compliance_watch",
      gate: { hourUtc: env.HERMES_COMPLIANCE_HOUR_UTC },
      usesLlm: false,
      handler: async () => {
        const { runComplianceWatch } = await import("../jobs/compliance-watch.js");
        return runComplianceWatch();
      },
    },
    {
      // Proposes only. Nothing here can close a period on its own — the
      // proposal waits in the approvals queue for a human.
      name: "period_close_watch",
      gate: { hourUtc: env.HERMES_CLOSE_WATCH_HOUR_UTC },
      usesLlm: false,
      handler: async () => {
        const { runPeriodCloseWatch } = await import("../jobs/period-close-watch.js");
        return runPeriodCloseWatch();
      },
    },
  ];
}
