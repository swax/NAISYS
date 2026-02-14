import { z } from "zod";

export const StatusResponseSchema = z.object({
  hubConnected: z.boolean(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
