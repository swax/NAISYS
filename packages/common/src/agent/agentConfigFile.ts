import { z } from "zod";

import {
  URL_SAFE_KEY_MESSAGE,
  URL_SAFE_KEY_REGEX,
} from "../auth/urlSafeKey.js";
import { TARGET_MEGAPIXELS } from "../config/constants.js";
import { ScheduleEntrySchema } from "./scheduleUtils.js";

export const commandProtectionValues = [
  "none",
  "manual",
  "semi-auto",
  "auto",
] as const;

export const continuityValues = ["fresh", "summary", "full"] as const;

const UserConfigContinuitySchema = z
  .object({ continuity: z.string().optional() })
  .loose();

/** Pull just the `continuity` field out of a stored `users.config` JSON string.
 *  Returns undefined on null/missing/parse failure so callers can treat
 *  unset and invalid the same way (both mean "fresh"). Uses `passthrough`
 *  so an otherwise-malformed config still yields a usable continuity value. */
export function parseContinuityFromConfigJson(
  configJson: string | null | undefined,
): string | undefined {
  if (!configJson) return undefined;
  try {
    return UserConfigContinuitySchema.parse(JSON.parse(configJson)).continuity;
  } catch {
    return undefined;
  }
}

const UserConfigSpendLimitsSchema = z
  .object({
    spendLimitDollars: z.number().optional(),
    spendLimitHours: z.number().optional(),
  })
  .loose();

/** Pull spend-limit fields out of a stored `users.config` JSON string. Returns
 *  `{}` on null/missing/parse failure — both mean "no per-agent limit". Shared
 *  by the hub's spend enforcement and the supervisor's voice budget check. */
export function parseSpendLimitsFromConfigJson(
  configJson: string | null | undefined,
): { spendLimitDollars?: number; spendLimitHours?: number } {
  if (!configJson) return {};
  try {
    const parsed = UserConfigSpendLimitsSchema.parse(JSON.parse(configJson));
    return {
      spendLimitDollars: parsed.spendLimitDollars,
      spendLimitHours: parsed.spendLimitHours,
    };
  } catch {
    return {};
  }
}

// Zod schema for validation
export const AgentConfigFileSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE)
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
      "Spend limit in dollars for this agent. When set, this agent is exempt from the global spend limit. Defaults to the SPEND_LIMIT_DOLLARS variable",
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
      "Legacy: Mail encourages more verbose communication, but is more confusing to follow, especially when combined with chat",
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
    .describe(
      "Allow agent to browse the web with a context-optimized text browser built on Lynx. Javascript not supported. Requires `lynx` on the host (e.g. `apt install lynx`)",
    ),

  browserEnabled: z
    .boolean()
    .optional()
    .describe(
      "Allow agent to browse the web with a real headless Chromium browser via Playwright. Vision-capable models see screenshots; others fall back to a text/selector mode. Requires `npx playwright install chromium` on the host",
    ),

  completeSessionEnabled: z
    .boolean()
    .optional()
    .describe(
      "Allow the agent to end its own session. Once ended, it can only be restarted explicitly or via chat/mail if wakeOnMessage is enabled. Turn off for agents you've instructed to wake periodically. The auto-compact advanced setting can be used to minimize idling costs.",
    ),

  debugPauseSeconds: z
    .number()
    .int("Must be a whole number")
    .min(0, "Must be non-negative")
    .optional()
    .describe(
      "Seconds to wait at the debug prompt before auto-continuing, only applies when the agent's console is in focus. Set to 0 to continue immediately. Unset waits indefinitely for manual input",
    ),

  wakeOnMessage: z
    .boolean()
    .optional()
    .describe(
      "When mail or chat is received, start the agent automatically, or wake it from its wait state",
    ),

  commandProtection: z
    .enum(commandProtectionValues)
    .optional()
    .describe(
      "Only works in standalone mode. None allows the LLM to run any command, Manual requires user confirmation for each command, and Auto uses a secondary LLM to try to validate a command is safe",
    ),

  autoCompact: z
    .boolean()
    .optional()
    .describe(
      "Automatically compact the session after five minutes of idle time to save on API costs by avoiding cache-miss reads. Good for agents that idle for long periods.",
    ),

  continuity: z
    .enum(continuityValues)
    .optional()
    .describe(
      "How a new run starts: 'fresh' begins with no prior context, 'summary' restores from a compacted summary saved before the previous run ended, 'full' restores the entire prior context and only compacts when explicitly called",
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
      "Allow the LLM to run multiple commands per turn. Faster but the LLM may get ahead of itself and produce errors. Disable for weaker LLMs.",
    ),

  workspacesEnabled: z
    .boolean()
    .optional()
    .describe(
      "Experimental: Allows the LLM to pin files to the end of the context. Each turn the agent sees the latest version without old versions taking up context space",
    ),

  controlDesktop: z
    .boolean()
    .optional()
    .describe(
      `Allow the agent to operate the desktop GUI. Requires a vision-capable model; computer-use models are ideal. Screens over ${TARGET_MEGAPIXELS}MP will be downscaled.`,
    ),

  supervisorApiHints: z
    .boolean()
    .optional()
    .describe(
      "Tell the agent in its system message how to call the supervisor API to manage NAISYS agents, hosts, variables, models, users, etc. Useful for admin / assistant agents",
    ),

  schedules: z
    .array(ScheduleEntrySchema)
    .optional()
    .superRefine((schedules, ctx) => {
      if (!schedules) return;
      const seen = new Set<string>();
      for (let i = 0; i < schedules.length; i++) {
        const name = schedules[i].name;
        if (seen.has(name)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "name"],
            message: `Duplicate schedule name "${name}"`,
          });
        }
        seen.add(name);
      }
    })
    .describe(
      "Cron schedules that wake the agent and deliver a chat from admin at fire time. Cron runs in the hub's local timezone. If the agent is offline, the chat queues and dedupes per schedule name.",
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
    tokenMax: 30000,
    mailEnabled: false,
    chatEnabled: true,
    webEnabled: true,
    browserEnabled: true,
    wakeOnMessage: true,
    completeSessionEnabled: true,
    multipleCommandsEnabled: true,
    // Gives agent memory a light memory of recent interactions
    initialCommands: ["ns-chat help", "ns-chat recent"],
  };
}

export const adminAgentConfig = {
  username: "admin", // Must be "admin" for special handling in hub and supervisor
  title: "Admin",
  shellModel: "none",
  agentPrompt: "Human admin for monitoring and control.",
  tokenMax: 100_000,
  mailEnabled: true,
  chatEnabled: true,
  wakeOnMessage: true,
  webEnabled: true,
  // Rolling daily cap. Admin does no LLM work (shellModel "none") but voice
  // usage attributes to its session, so this is the real voice cost cap.
  // Rolling so it auto-resets each period.
  spendLimitDollars: 25,
  spendLimitHours: 24,
} satisfies AgentConfigFile;

export interface UserEntry {
  userId: number;
  username: string;
  enabled: boolean;
  leadUserId?: number;
  assignedHostIds?: number[];
  config: AgentConfigFile;
  isEphemeral?: boolean;
}
