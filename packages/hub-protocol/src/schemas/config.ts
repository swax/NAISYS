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
      webTokenMax: z.number(),
      compactSessionEnabled: z.boolean(),
      preemptiveCompactEnabled: z.boolean(),
      variableMap: z.record(z.string(), z.string()),
      shellVariableMap: z.record(z.string(), z.string()),
      googleSearchEngineId: z.string().optional(),
      spendLimitDollars: z.number().optional(),
      spendLimitHours: z.number().optional(),
      useToolsForLlmConsoleResponses: z.boolean(),
      autoStartAgentsOnMessage: z.boolean(),
      mailServiceEnabled: z.boolean(),
    })
    .optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

export const VariablePatchEntrySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z_][A-Z0-9_]*$/),
  value: z.string(),
});
export type VariablePatchEntry = z.infer<typeof VariablePatchEntrySchema>;

export const VariablePatchRequestSchema = z.object({
  updates: z.array(VariablePatchEntrySchema).min(1).max(25),
});
export type VariablePatchRequest = z.infer<typeof VariablePatchRequestSchema>;
