import { z } from "zod";

export enum CommandProtection {
  None = "none",
  Manual = "manual",
  Auto = "auto",
}

// Zod schema for validation
export const AgentConfigFileSchema = z.object({
  _id: z.string().optional(),
  username: z.string(),
  title: z.string(),
  agentPrompt: z.string(),

  /** Local spend limit for this agent */
  spendLimitDollars: z.number().optional(),

  /** Time period in hours for spend limit. If not set, spend limit applies to all time */
  spendLimitHours: z.number().optional(),

  tokenMax: z.number(),

  shellModel: z.string(),
  webModel: z.string().optional(),
  compactModel: z.string().optional(),
  imageModel: z.string().optional(),

  /** Mail is integral to sub-agents and all that, disabling just hides knowledge of it. Subagents starting/completing still send mail behind the scene to communicate */
  mailEnabled: z.boolean().optional(),

  webEnabled: z.boolean().optional(),

  /** Allows agent a way to stop running completely. In subagent mode the app is exited */
  completeSessionEnabled: z.boolean().optional(),

  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds: z.number().optional(),
  wakeOnMessage: z.boolean().optional(),
  commandProtection: z.enum(CommandProtection).optional(),
  initialCommands: z.array(z.string()).optional(),

  /**
   * Disable multiple commands
   * + Prevents LLMs from hallucinating it's own output
   * + Prevents LLMs from issuing commands before evaluating previous command output
   * - Slower going back and forth to the LLM
   * - Costs more, but query caching reduces most of the impact
   */
  disableMultipleCommands: z.boolean().optional(),

  /** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
  workspacesEnabled: z.boolean().optional(),
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
  _id: "admin-user-id",
  username: "admin",
  title: "",
  shellModel: "none",
  agentPrompt: "Human admin for monitoring and control.",
  tokenMax: 100_000,
  spendLimitDollars: 1, // Required on all agents
} satisfies AgentConfigFile;

export interface UserEntry {
  userId: number;
  username: string;
  configId: string;
  leadUserId?: number;
  agentPath?: string;
  assignedHostIds?: number[];
  config: AgentConfigFile;
}
