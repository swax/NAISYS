import { z } from "zod";

/** Pushed from hub to NAISYS instances on connect with global config */
export const ConfigResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  config: z
    .object({
      shellCommand: z.object({
        outputTokenMax: z.number(),
        timeoutSeconds: z.number(),
        maxTimeoutSeconds: z.number(),
      }),
      retrySecondsBase: z.number(),
      retrySecondsMax: z.number(),
      compactSessionEnabled: z.boolean(),
      preemptiveCompactEnabled: z.boolean(),
      variableMap: z.record(z.string(), z.string()),
      shellVariableMap: z.record(z.string(), z.string()),
      googleSearchEngineId: z.string().optional(),
      spendLimitDollars: z.number().optional(),
      spendLimitHours: z.number().optional(),
      codexUsageLimitPercent: z.number().optional(),
      codexUsageCheckMinutes: z.number().optional(),
      useToolsForLlmConsoleResponses: z.boolean(),
      autoStartAgentsOnMessage: z.boolean(),
      mailServiceEnabled: z.boolean(),
      /** IANA TZ all hub-side time evaluation uses (cron firing, log
       *  display defaults, etc). Controlled by the TIMEZONE variable;
       *  falls back to the hub process's resolved TZ. */
      hubTimezone: z.string(),
    })
    .optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
