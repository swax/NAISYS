import { z } from "zod";

// Zod schemas
export const SettingsSchema = z.object({
  example: z.string(),
});

export const SettingsRequestSchema = z.object({
  settings: SettingsSchema,
});

export const SettingsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  settings: SettingsSchema.optional(),
});

// Inferred types
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsRequest = z.infer<typeof SettingsRequestSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
