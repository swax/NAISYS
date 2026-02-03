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

export const debugUserId = "debug-user-id";

export const debugAgentConfig = {
  _id: debugUserId,
  username: "debug",
  title: "",
  shellModel: "none",
  agentPrompt: "Debug agent for monitoring and control.",
  tokenMax: 100_000,
  spendLimitDollars: 1, // Required on all agents
} satisfies AgentConfigFile;

export interface UserEntry {
  userId: string;
  leadUserId?: string;
  agentPath?: string;
  config: AgentConfigFile;
}
