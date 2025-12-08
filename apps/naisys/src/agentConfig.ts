import * as fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { z } from "zod";
import { GlobalConfig } from "./globalConfig.js";
import { CommandProtection } from "./utils/enums.js";
import { sanitizeSpendLimit, valueFromString } from "./utils/utilities.js";

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

  /** The max number of subagents allowed to be started and managed. Costs by the subagent are applied to the spend limit. */
  subagentMax: z.number().optional(),

  /** A directory to scan for subagent files. The leadAgent setting in a config determines who can start the subagent. */
  subagentDirectory: z.string().optional(),

  /** Used to prevent the agent from constantly responding to mail and not getting any work done */
  mailBlackoutCycles: z.number().optional(),

  /** Try to enfore smaller messages between agents to improve communication efficiency */
  mailMessageTokenMax: z.number().optional(),

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
});

export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

export function createAgentConfig(
  agentPath: string,
  { globalConfig }: GlobalConfig,
) {
  let cachedConfig = loadConfig();

  function loadConfig() {
    const rawConfig = yaml.load(fs.readFileSync(agentPath, "utf8"));
    const config = AgentConfigFileSchema.parse(rawConfig);

    // Sanitize spend limits
    const spendLimitDollars = sanitizeSpendLimit(config.spendLimitDollars);
    const spendLimitHours = sanitizeSpendLimit(config.spendLimitHours);

    // Validate if spend limit is defined on the agent or .env
    if (
      spendLimitDollars === undefined &&
      globalConfig().spendLimitDollars === undefined
    ) {
      throw `Agent config: Error, 'spendLimitDollars' needs to be defined in the .env file or agent config`;
    }

    // Resolve model configs
    const shellModel = resolveConfigVars(config.shellModel);
    const webModel = resolveConfigVars(config.webModel || config.shellModel);
    const compactModel = resolveConfigVars(
      config.compactModel || config.shellModel,
    );
    const imageModel = config.imageModel
      ? resolveConfigVars(config.imageModel)
      : undefined;

    function resolveConfigVars(templateString: string) {
      let resolvedString = templateString;
      resolvedString = resolveTemplateVars(resolvedString, "agent", config);
      resolvedString = resolveTemplateVars(resolvedString, "env", process.env);
      return resolvedString;
    }

    function resolveTemplateVars(
      templateString: string,
      allowedVarString: string,
      mappedVar: any,
    ) {
      const pattern = new RegExp(`\\$\\{${allowedVarString}\\.([^}]+)\\}`, "g");

      return templateString.replace(pattern, (_match, key) => {
        const value = valueFromString(mappedVar, key);
        if (value === undefined) {
          throw `Agent config: Error, ${key} is not defined`;
        }
        return value;
      });
    }

    return {
      ...config,
      hostpath: path.resolve(agentPath),
      spendLimitDollars,
      spendLimitHours,
      shellModel,
      webModel,
      compactModel,
      imageModel,
      resolveConfigVars,
      mailEnabled: config.mailEnabled ?? false,
      webEnabled: config.webEnabled ?? false,
      completeTaskEnabled: config.completeTaskEnabled ?? false,
      wakeOnMessage: config.wakeOnMessage ?? false,
      initialCommands: config.initialCommands ?? [],
      commandProtection: config.commandProtection ?? CommandProtection.None,
      debugPauseSeconds:
        config.debugPauseSeconds === undefined
          ? 1000
          : config.debugPauseSeconds,
      disableMultipleCommands:
        config.disableMultipleCommands === undefined
          ? true
          : config.disableMultipleCommands,
    };
  }

  return {
    agentConfig: () => cachedConfig,
    reloadAgentConfig: () => {
      cachedConfig = loadConfig();
    },
  };
}

export type AgentConfig = ReturnType<typeof createAgentConfig>;
