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

export const CodexOAuthStartResponseSchema = z.object({
  success: z.literal(true),
  flowId: z.string(),
  verificationUrl: z.string(),
  userCode: z.string(),
  expiresAt: z.number(),
  intervalMs: z.number(),
});

export type CodexOAuthStartResponse = z.infer<
  typeof CodexOAuthStartResponseSchema
>;

export const CodexOAuthPollRequestSchema = z.object({
  flowId: z.string(),
});

export type CodexOAuthPollRequest = z.infer<
  typeof CodexOAuthPollRequestSchema
>;

export const CodexOAuthPollResponseSchema = z.object({
  success: z.literal(true),
  status: z.enum(["pending", "complete", "expired"]),
  message: z.string(),
  savedKeys: z.array(z.string()).optional(),
});

export type CodexOAuthPollResponse = z.infer<
  typeof CodexOAuthPollResponseSchema
>;

export const CodexUsageWindowSchema = z.object({
  limitWindowSeconds: z.number().optional(),
  usedPercent: z.number().optional(),
  resetAt: z.number().optional(),
  resetAfterSeconds: z.number().optional(),
});

export type CodexUsageWindow = z.infer<
  typeof CodexUsageWindowSchema
>;

export const CodexOAuthUsageResponseSchema = z.object({
  success: z.literal(true),
  checkedAt: z.number(),
  limitReached: z.boolean().optional(),
  primaryWindow: CodexUsageWindowSchema.optional(),
  secondaryWindow: CodexUsageWindowSchema.optional(),
  message: z.string(),
});

export type CodexOAuthUsageResponse = z.infer<
  typeof CodexOAuthUsageResponseSchema
>;
