import { z } from "zod";

/**
 * Environment contract. Validated eagerly at import so a misconfigured deploy
 * dies at boot with a readable list rather than at 3am inside a job.
 */

/**
 * `z.coerce.boolean()` is `Boolean(string)`, which makes the string "false"
 * TRUE. That bug is how you accidentally leave an expensive job armed, so
 * booleans get an explicit parser.
 */
function envBool(dflt: boolean) {
  return z
    .string()
    .default(dflt ? "true" : "false")
    .transform((v) => /^(1|true|yes|on)$/i.test(v.trim()));
}

const schema = z.object({
  ROLE: z.enum(["worker", "web"]).default("worker"),
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Studio database — the same project the Next.js app uses.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Providers. The studio's `app_settings.ai.active_provider` decides WHICH is
  // used at runtime; these supply the keys and let a deploy pin a base URL.
  MOONSHOT_API_KEY: z.string().optional(),
  ZHIPU_API_KEY: z.string().optional(),
  MOONSHOT_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  ZHIPU_BASE_URL: z.string().url().default("https://api.z.ai/api/paas/v4"),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),

  // Loop cadences and caps.
  HERMES_SCHEDULER_TICK_MS: z.coerce.number().default(5 * 60_000),
  HERMES_APPROVAL_SWEEP_MS: z.coerce.number().default(10_000),
  HERMES_MAX_RUN_ITERATIONS: z.coerce.number().default(8),
  HERMES_DAILY_COST_CAP_USD: z.coerce.number().default(5),
  // Conversational memory. HISTORY_KEEP is turn PAIRS, not messages.
  HERMES_HISTORY_KEEP: z.coerce.number().default(6),
  HERMES_CHAT_IDLE_MIN: z.coerce.number().default(30),

  // Job gates (UTC hours / day-of-week, 0 = Sunday).
  HERMES_BRIEF_HOUR_UTC: z.coerce.number().default(6),
  HERMES_COMPLIANCE_HOUR_UTC: z.coerce.number().default(7),
  HERMES_CLOSE_WATCH_HOUR_UTC: z.coerce.number().default(8),
  HERMES_PAYOUT_WATCH_HOUR_UTC: z.coerce.number().default(9),
  HERMES_FORECAST_DOW: z.coerce.number().default(1),

  HERMES_DRY_RUN: envBool(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = loadEnv();
