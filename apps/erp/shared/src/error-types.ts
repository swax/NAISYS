import { z } from "zod/v4";

export const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  /**
   * For 403 responses raised by a permission check, the name of the
   * missing permission. Lets clients react structurally without having
   * to parse the human-readable `message`.
   */
  missingPermission: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
