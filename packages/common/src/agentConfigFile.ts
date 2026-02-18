import { z } from "zod";

export enum CommandProtection {
  None = "none",
  Manual = "manual",
  Auto = "auto",
}

// Zod schema for validation
export const AgentConfigFileSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .describe("Agent username, must be unique"),
  title: z.string().describe("Agent role/title"),
  agentPrompt: z
    .string()
    .min(1, "Agent prompt is required")
    .describe(
      "System prompt sent to the LLM. Supports ${agent.*} template variables",
    ),

  spendLimitDollars: z
    .number()
    .min(0, "Must be non-negative")
    .optional()
    .describe("Local spend limit in dollars for this agent"),
  spendLimitHours: z
    .number()
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Rolling time window in hours for spend limit. If unset, limit applies to all time",
    ),

  tokenMax: z
    .number()
    .int("Must be a whole number")
    .min(1, "Must be at least 1")
    .describe("Maximum context window tokens before compaction"),

  shellModel: z
    .string()
    .min(1, "Shell model is required")
    .describe("Primary LLM model used for shell interactions"),
  webModel: z.string().optional().describe("Model used for web browsing tasks"),
  compactModel: z
    .string()
    .optional()
    .describe("Model used for context compaction"),
  imageModel: z.string().optional().describe("Model used for image generation"),

  mailEnabled: z
    .boolean()
    .optional()
    .describe(
      "Show mail commands to agent. Sub-agent mail still works behind the scenes when disabled",
    ),
  webEnabled: z.boolean().optional().describe("Allow agent to browse the web"),
  completeSessionEnabled: z
    .boolean()
    .optional()
    .describe(
      "Allow agent to end its own session. In sub-agent mode the app exits",
    ),

  debugPauseSeconds: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Seconds to pause at debug prompt before auto-continuing. 0 or unset = wait indefinitely",
    ),
  wakeOnMessage: z
    .boolean()
    .optional()
    .describe("Start agent automatically when it receives mail"),
  commandProtection: z
    .enum(CommandProtection)
    .optional()
    .describe(
      "Guard destructive commands: none, manual approval, or auto-check",
    ),
  initialCommands: z
    .array(z.string())
    .optional()
    .describe("Shell commands to run at session start before the LLM prompt"),

  disableMultipleCommands: z
    .boolean()
    .optional()
    .describe(
      "Force one command per turn. Slower but prevents hallucinated output",
    ),
  workspacesEnabled: z
    .boolean()
    .optional()
    .describe(
      "Experimental: live-updating context area for files, avoids repeated cat calls",
    ),
});

export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

/**
 * Thoughts on the admin user:
 * 1. We need an admin user as a placeholder when no agents are running
 *    Especially when a hub client starts up and the hub has assigned no agents to the host
 * 2. We want to be able to start agents and send mail from the placeholder so it needs to be an official user
 *    It is registered in the hub db as well so we don't need tons of special case code everywhere like `if (userId === adminUserId)` ...
 * 3. The admin is also a source of ns-talk commands, gives the LLM someone to reply to
 * 4. Calling it a debug user would be confusing with debug input mode, also considered calling it operator, but admin seems more intuitive
 * 5. The hub supports agents running simultaneously across hosts, so each client can run an admin fine
 * 6. Having it as an official user means mail will be logged by the hub as well which is helpful for debugging and monitoring
 */
export const adminAgentConfig = {
  username: "admin", // Must be "admin" for special handling in hub and supervisor
  title: "Admin",
  shellModel: "none",
  agentPrompt: "Human admin for monitoring and control.",
  tokenMax: 100_000,
  spendLimitDollars: 1, // Required on all agents
} satisfies AgentConfigFile;

export interface UserEntry {
  userId: number;
  username: string;
  leadUserId?: number;
  assignedHostIds?: number[];
  apiKey?: string;
  config: AgentConfigFile;
}
