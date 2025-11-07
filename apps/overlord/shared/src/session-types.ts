import { z } from "zod";

// Zod schemas
export const AccessKeyRequestSchema = z.object({
  accessKey: z.string(),
});

export const AccessKeyResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  token: z.string().optional(),
});

export const SessionResponseSchema = z.object({
  success: z.boolean(),
  username: z.string().optional(),
  startDate: z.string().optional(),
  expireDate: z.string().optional(),
  message: z.string().optional(),
});

export const LogoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Inferred types
export type AccessKeyRequest = z.infer<typeof AccessKeyRequestSchema>;
export type AccessKeyResponse = z.infer<typeof AccessKeyResponseSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
