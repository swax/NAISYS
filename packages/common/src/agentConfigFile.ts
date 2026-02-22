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
    .describe(
      "The name the agent identifies itself with when communicating with other agents",
    ),

  title: z
    .string()
    .describe(
      "Displayed to other agents to give context about this agent's role in the system",
    ),

  agentPrompt: z
    .string()
    .min(1, "Agent prompt is required")
    .describe(
      "Gives the agent instructions and/or purpose when starting up. Supports ${agent.*} and ${env.*} template variables",
    ),

  spendLimitDollars: z
    .number()
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Local spend limit in dollars for this agent, defaults to the SPEND_LIMIT_DOLLARS variable",
    ),

  spendLimitHours: z
    .number()
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Rolling time window in hours for spend limit, defaults to the SPEND_LIMIT_HOURS variable. If neither are set then the spend limit is fixed and not rolling",
    ),

  tokenMax: z
    .number()
    .int("Must be a whole number")
    .min(1, "Must be at least 1")
    .describe(
      "How many tokens this agent is allocated per session before it must end or compact the context",
    ),

  shellModel: z
    .string()
    .min(1, "Shell model is required")
    .describe("Primary LLM used for shell interactions"),

  imageModel: z.string().optional().describe("Model used for image generation"),

  mailEnabled: z
    .boolean()
    .optional()
    .describe(
      "Show mail commands to the agent. Mail encourages verbose communication which can be distracting",
    ),

  chatEnabled: z
    .boolean()
    .optional()
    .describe(
      "Show chat commands to the agent. Chat encourages more concise communication",
    ),

  webEnabled: z
    .boolean()
    .optional()
    .describe("Allow agent to browse the web with Lynx, a text based browser"),

  completeSessionEnabled: z
    .boolean()
    .optional()
    .describe(
      "Allow the agent to end its session. Once ended, it can only be restarted explicitly or via mail if wakeOnMessage is enabled. Disable on root agents to prevent the system from going unresponsive",
    ),

  debugPauseSeconds: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Seconds to wait at the debug prompt before auto-continuing, only applies when the agent's console is in focus. Unset waits indefinitely for manual input",
    ),

  wakeOnMessage: z
    .boolean()
    .optional()
    .describe(
      "When mail or chat is received, start the agent automatically, or wake it from its wait state",
    ),

  commandProtection: z
    .enum(CommandProtection)
    .optional()
    .describe(
      "None allows the LLM to run any command, Manual requires user confirmation for each command, and Auto uses a secondary LLM to try to validate a command is safe",
    ),

  initialCommands: z
    .array(z.string())
    .optional()
    .describe(
      "Shell commands to run at session start before the first LLM prompt, providing additional context to the agent",
    ),

  multipleCommandsEnabled: z
    .boolean()
    .optional()
    .describe(
      "Allow the LLM to run multiple commands per turn. Faster but the LLM may get ahead of itself and produce errors",
    ),

  workspacesEnabled: z
    .boolean()
    .optional()
    .describe(
      "Experimental: Allows the LLM to pin files to the end of the context. Each turn the agent sees the latest version without old versions taking up context space",
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
export function buildDefaultAgentConfig(username: string): AgentConfigFile {
  return {
    username,
    title: "Assistant",
    shellModel: "none",
    agentPrompt:
      "You are ${agent.username} a ${agent.title} with the job of helping out the admin with what they want to do.",
    tokenMax: 20000,
    debugPauseSeconds: 5,
    chatEnabled: true,
    webEnabled: true,
    wakeOnMessage: true,
    completeSessionEnabled: true,
    multipleCommandsEnabled: true,
  };
}

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
