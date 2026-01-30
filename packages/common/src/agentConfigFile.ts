import { z } from "zod";

export enum CommandProtection {
  None = "none",
  Manual = "manual",
  Auto = "auto",
}

// Zod schema for validation
export const AgentConfigFileSchema = z.object({
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

  mailEnabled: z.boolean().optional(),
  webEnabled: z.boolean().optional(),

  /** Allows agent a way to stop running completely unless a message is received. In subagent mode the app is exited */
  completeTaskEnabled: z.boolean().optional(),

  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds: z.number().optional(),
  wakeOnMessage: z.boolean().optional(),
  commandProtection: z.enum(CommandProtection).optional(),
  initialCommands: z.array(z.string()).optional(),

  /** A directory to scan for subagent files. The leadAgent setting in a config determines who can start the subagent. */
  subagentDirectory: z.string().optional(),

  /**
   * Disable multiple commands
   * + Prevents LLMs from hallucinating it's own output
   * + Prevents LLMs from issuing commands before evaluating previous command output
   * - Slower going back and forth to the LLM
   * - Costs more, but query caching reduces most of the impact
   */
  disableMultipleCommands: z.boolean().optional(),

  /** ONLY used by agent start process. Indicates that this is a subagent, and this is the lead agent */
  leadAgent: z.string().optional(),

  /** ONLY used by agent start process. The task given to the subagent */
  taskDescription: z.string().optional(),

  complexMail: z.boolean().optional(),

  /** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
  workspacesEnabled: z.boolean().optional(),
});

export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

export const defaultAdminConfig = {
  username: "admin",
  title: "Administrator",
  shellModel: "none",
  agentPrompt: "Admin agent for monitoring and control.",
  tokenMax: 100_000,
} satisfies AgentConfigFile;

export interface UserEntry {
  config: AgentConfigFile;
  agentPath: string;
  configYaml: string;
}
