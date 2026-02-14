import { z } from "zod";

export const StatusResponseSchema = z.object({
  hubConnected: z.boolean(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const AgentStatusEventSchema = z.object({
  agents: z.record(
    z.string(),
    z.object({
      online: z.boolean(),
      latestLogId: z.number(),
      latestMailId: z.number(),
    }),
  ),
  hosts: z
    .record(
      z.string(),
      z.object({
        online: z.boolean(),
      }),
    )
    .optional(),
});

export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;
