import { z } from "zod";

// Zod schemas
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  host: z.string(),
  lastActive: z.string().optional(),
  agentPath: z.string().optional(),
  leadUsername: z.string().optional(),
  latestLogId: z.string(),
  latestMailId: z.string(),
});

export const HostSchema = z.object({
  name: z.string(),
  lastActive: z.string().nullable(),
  agentCount: z.number(),
});

// Inferred types
export type Agent = z.infer<typeof AgentSchema>;
export type Host = z.infer<typeof HostSchema>;
