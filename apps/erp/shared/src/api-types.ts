import { z } from "zod/v4";

export const HelloResponseSchema = z.object({
  message: z.string(),
});

export type HelloResponse = z.infer<typeof HelloResponseSchema>;
