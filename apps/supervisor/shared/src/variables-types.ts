import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

export const VariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  exportToShell: z.boolean(),
  sensitive: z.boolean(),
});

export type Variable = z.infer<typeof VariableSchema>;

export const VariablesResponseSchema = z.object({
  items: z.array(VariableSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type VariablesResponse = z.infer<typeof VariablesResponseSchema>;

export const SaveVariableRequestSchema = z.object({
  value: z.string(),
  exportToShell: z.boolean(),
  sensitive: z.boolean(),
});

export type SaveVariableRequest = z.infer<typeof SaveVariableRequestSchema>;

export const SaveVariableResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SaveVariableResponse = z.infer<typeof SaveVariableResponseSchema>;

export const DeleteVariableParamsSchema = z.object({
  key: z.string(),
});

export type DeleteVariableParams = z.infer<typeof DeleteVariableParamsSchema>;

export const DeleteVariableResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type DeleteVariableResponse = z.infer<
  typeof DeleteVariableResponseSchema
>;

export const OpenAiCodexOAuthStartResponseSchema = z.object({
  success: z.literal(true),
  flowId: z.string(),
  verificationUrl: z.string(),
  userCode: z.string(),
  expiresAt: z.number(),
  intervalMs: z.number(),
});

export type OpenAiCodexOAuthStartResponse = z.infer<
  typeof OpenAiCodexOAuthStartResponseSchema
>;

export const OpenAiCodexOAuthPollRequestSchema = z.object({
  flowId: z.string(),
});

export type OpenAiCodexOAuthPollRequest = z.infer<
  typeof OpenAiCodexOAuthPollRequestSchema
>;

export const OpenAiCodexOAuthPollResponseSchema = z.object({
  success: z.literal(true),
  status: z.enum(["pending", "complete", "expired"]),
  message: z.string(),
  savedKeys: z.array(z.string()).optional(),
});

export type OpenAiCodexOAuthPollResponse = z.infer<
  typeof OpenAiCodexOAuthPollResponseSchema
>;

export const OpenAiCodexUsageWindowSchema = z.object({
  limitWindowSeconds: z.number().optional(),
  usedPercent: z.number().optional(),
  resetAt: z.number().optional(),
  resetAfterSeconds: z.number().optional(),
});

export type OpenAiCodexUsageWindow = z.infer<
  typeof OpenAiCodexUsageWindowSchema
>;

export const OpenAiCodexOAuthUsageResponseSchema = z.object({
  success: z.literal(true),
  checkedAt: z.number(),
  limitReached: z.boolean().optional(),
  primaryWindow: OpenAiCodexUsageWindowSchema.optional(),
  secondaryWindow: OpenAiCodexUsageWindowSchema.optional(),
  message: z.string(),
  refreshed: z.boolean().optional(),
});

export type OpenAiCodexOAuthUsageResponse = z.infer<
  typeof OpenAiCodexOAuthUsageResponseSchema
>;
