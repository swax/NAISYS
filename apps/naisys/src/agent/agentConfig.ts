import { DatabaseService } from "@naisys/database";
import yaml from "js-yaml";
import table from "text-table";
import { z } from "zod";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { CommandProtection } from "../utils/enums.js";
import { sanitizeSpendLimit, valueFromString } from "../utils/utilities.js";

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

export async function createAgentConfig(
  userId: string,
  { usingDatabase }: DatabaseService,
  { globalConfig }: GlobalConfig,
) {
  let cachedConfig = await loadConfigFromDb();

  async function loadConfigFromDb() {
    const user = await usingDatabase(async (prisma) => {
      return await prisma.users.findUnique({
        where: { id: userId },
        select: { config: true },
      });
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    return parseConfig(user.config);
  }

  function parseConfig(yamlContent: string) {
    const rawConfig = yaml.load(yamlContent);
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
      spendLimitDollars,
      spendLimitHours,
      shellModel,
      webModel,
      compactModel,
      imageModel,
      resolveConfigVars,
      mailEnabled: config.mailEnabled ?? false,
      webEnabled: config.webEnabled ?? false,
      completeTaskEnabled: config.completeTaskEnabled ?? true,
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
      workspacesEnabled: config.workspacesEnabled ?? false,
    };
  }

  async function updateConfigField(field: string, value: string) {
    // Load current raw config from database
    const user = await usingDatabase(async (prisma) => {
      return await prisma.users.findUnique({
        where: { id: userId },
        select: { config: true },
      });
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    // Parse, update, and serialize
    const rawConfig = yaml.load(user.config) as Record<string, unknown>;

    // Convert value to appropriate type
    let typedValue: unknown = value;
    if (value === "true") typedValue = true;
    else if (value === "false") typedValue = false;
    else if (!isNaN(Number(value)) && value.trim() !== "")
      typedValue = Number(value);

    rawConfig[field] = typedValue;

    const updatedYaml = yaml.dump(rawConfig);

    // Save to database
    await usingDatabase(async (prisma) => {
      await prisma.users.update({
        where: { id: userId },
        data: { config: updatedYaml },
      });
    });

    // Reload cached config
    cachedConfig = await loadConfigFromDb();
  }

  async function handleCommand(cmdArgs: string): Promise<string> {
    const args = cmdArgs.trim().split(/\s+/).filter(Boolean);
    const config = cachedConfig;

    if (args.length === 0) {
      // Show all config values as a table
      const rows = Object.entries(config)
        .filter(([, value]) => typeof value !== "function")
        .map(([key, value]) => {
          const displayValue =
            typeof value === "object" ? JSON.stringify(value) : String(value);
          return [key, displayValue];
        });
      return table([["Name", "Value"], ...rows], { hsep: " | " });
    } else if (args.length === 1) {
      // Show specific config value
      const name = args[0];
      const value = (config as Record<string, unknown>)[name];
      if (value === undefined) {
        return `Config field '${name}' not found`;
      }
      if (typeof value === "function") {
        return `Config field '${name}' is a function and cannot be displayed`;
      }
      return typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
    } else {
      // Update config value
      const name = args[0];
      const value = args.slice(1).join(" ");
      try {
        await updateConfigField(name, value);
        return `Config field '${name}' updated to '${value}' and reloaded`;
      } catch (error) {
        return `Failed to update config: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-agent-config",
    helpText: "View or update agent config: ns-agent-config [name] [value]",
    isDebug: true,
    handleCommand,
  };

  return {
    ...registrableCommand,
    agentConfig: () => cachedConfig,
    reloadAgentConfig: async () => {
      cachedConfig = await loadConfigFromDb();
    },
    updateConfigField,
  };
}

export type AgentConfig = Awaited<ReturnType<typeof createAgentConfig>>;
