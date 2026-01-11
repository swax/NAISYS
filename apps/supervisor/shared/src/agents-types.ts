import { z } from "zod";

// Zod schemas
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  lastActive: z.string().optional(),
  agentPath: z.string().optional(),
  leadUsername: z.string().optional(),
  latestLogId: z.string(),
  latestMailId: z.string(),
});

// Inferred types
export type Agent = z.infer<typeof AgentSchema>;
