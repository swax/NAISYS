import { z } from "zod";

/** How often NAISYS instances send heartbeats to the hub (ms) */
export const NAISYS_HEARTBEAT_INTERVAL_MS = 2000;

/** How often the hub pushes aggregate active user status to all connections (NAISYS/Supervisors) (ms) */
export const HUB_HEARTBEAT_INTERVAL_MS = 2000;

/** Sent by NAISYS instance to hub with active user IDs */
export const HeartbeatSchema = z.object({
  activeUserIds: z.array(z.number()),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

/** Per-agent notification IDs pushed from hub to connected clients */
export const AgentNotificationSchema = z.object({
  latestLogId: z.number(),
  latestMailId: z.number(),
  latestChatId: z.number(),
});
export type AgentNotification = z.infer<typeof AgentNotificationSchema>;

/** Sent by hub to NAISYS instances with aggregate active agents and notifications */
export const AgentsStatusSchema = z.object({
  hostActiveAgents: z.record(z.string(), z.array(z.number())),
  agentNotifications: z.record(z.string(), AgentNotificationSchema).optional(),
});
export type AgentsStatus = z.infer<typeof AgentsStatusSchema>;
