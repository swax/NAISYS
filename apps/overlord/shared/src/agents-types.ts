import { z } from "zod";

// Zod schemas
export const AgentSchema = z.object({
  id: z.number(),
  name: z.string(),
  title: z.string(),
  online: z.boolean(),
  lastActive: z.string().optional(),
  agentPath: z.string().optional(),
  leadUsername: z.string().optional(),
  latestLogId: z.number(),
  latestMailId: z.number(),
});

// Inferred types
export type Agent = z.infer<typeof AgentSchema>;
