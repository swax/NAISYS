import { z } from "zod";

// Error response schema
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
});

// Inferred types
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
