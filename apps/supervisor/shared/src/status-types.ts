import { z } from "zod";

export const StatusResponseSchema = z.object({
  hubConnected: z.boolean(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const AgentStatusEventSchema = z.object({
  agents: z.record(
    z.string(),
    z.object({
      status: z.enum([
        "active",
        "available",
        "disabled",
        "offline",
        "suspended",
      ]),
      latestLogId: z.number(),
      latestMailId: z.number(),
    }),
  ),
  agentsListChanged: z.boolean().optional(),
});

export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;

export const HostStatusEventSchema = z.object({
  hosts: z.record(
    z.string(),
    z.object({
      online: z.boolean(),
    }),
  ),
  hostsListChanged: z.boolean().optional(),
});

export type HostStatusEvent = z.infer<typeof HostStatusEventSchema>;

export const HubStatusEventSchema = z.object({
  hubConnected: z.boolean(),
});

export type HubStatusEvent = z.infer<typeof HubStatusEventSchema>;
