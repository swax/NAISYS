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
      retrySecondsMax: z.number(),
      webTokenMax: z.number(),
      compactSessionEnabled: z.boolean(),
      variableMap: z.record(z.string(), z.string()),
      googleSearchEngineId: z.string().optional(),
      spendLimitDollars: z.number().optional(),
      spendLimitHours: z.number().optional(),
      useToolsForLlmConsoleResponses: z.boolean(),
    })
    .optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
