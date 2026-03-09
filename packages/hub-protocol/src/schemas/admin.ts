import { z } from "zod";

/** Request to rotate the hub access key (empty payload) */
export const RotateAccessKeyRequestSchema = z.object({});
export type RotateAccessKeyRequest = z.infer<
  typeof RotateAccessKeyRequestSchema
>;

/** Response after rotating the hub access key */
export const RotateAccessKeyResponseSchema = z.object({
  success: z.boolean(),
  newAccessKey: z.string().optional(),
  error: z.string().optional(),
});
export type RotateAccessKeyResponse = z.infer<
  typeof RotateAccessKeyResponseSchema
>;
