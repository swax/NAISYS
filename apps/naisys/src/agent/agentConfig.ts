import type { AgentConfigFile } from "@naisys/common";
import { resolveTemplateString, sanitizeSpendLimit } from "@naisys/common";
import table from "text-table";

import { agentConfigCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { UserService } from "./userService.js";

export function createAgentConfig(
  localUserId: number,
  { globalConfig }: GlobalConfig,
  userService: UserService,
) {
  let fullAgentConfig = loadConfig();

  function loadConfig() {
    const user = userService.getUserById(localUserId);

    if (!user) {
      throw new Error(`User with ID ${localUserId} not found`);
    }

    return buildFullAgentConfig(user.config);
  }

  function buildFullAgentConfig(config: AgentConfigFile) {
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
    const varMaps = {
      agent: config as Record<string, unknown>,
      env: globalConfig().variableMap as Record<string, unknown>,
    };

    const shellModel = resolveTemplateString(config.shellModel, varMaps);
    const imageModel = config.imageModel
      ? resolveTemplateString(config.imageModel, varMaps)
      : undefined;

    function resolveConfigVars(templateString: string) {
      return resolveTemplateString(templateString, varMaps);
    }

    return {
      ...config,
      spendLimitDollars,
      spendLimitHours,
      shellModel,
      imageModel,
      resolveConfigVars,
      mailEnabled: !!config.mailEnabled,
      chatEnabled: !!config.chatEnabled,
      webEnabled: !!config.webEnabled,
      browserEnabled: !!config.browserEnabled,
      completeSessionEnabled: !!config.completeSessionEnabled,
      wakeOnMessage: !!config.wakeOnMessage,
      initialCommands: config.initialCommands ?? [],
      commandProtection: config.commandProtection ?? "none",
      debugPauseSeconds: config.debugPauseSeconds,
      multipleCommandsEnabled: !!config.multipleCommandsEnabled,
      workspacesEnabled: !!config.workspacesEnabled,
    };
  }

  function updateConfigField(field: string, value: string) {
    const user = userService.getUserById(localUserId);

    if (!user) {
      throw new Error(`User with ID ${localUserId} not found`);
    }

    // Convert value to appropriate type
    let typedValue: unknown = value;
    if (value === "true") typedValue = true;
    else if (value === "false") typedValue = false;
    else if (!isNaN(Number(value)) && value.trim() !== "")
      typedValue = Number(value);

    // set field
    (user.config as any)[field] = typedValue;

    // Update in-memory only (not persisted)
    fullAgentConfig = buildFullAgentConfig(user.config);
  }

  function handleCommand(cmdArgs: string): string {
    const args = cmdArgs.trim().split(/\s+/).filter(Boolean);
    const config = fullAgentConfig;

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
      // Update config value (session-only, not persisted)
      const name = args[0];
      const value = args.slice(1).join(" ");
      try {
        updateConfigField(name, value);
        return `Config field '${name}' updated to '${value}' (session only, not persisted)`;
      } catch (error) {
        return `Failed to update config: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  const registrableCommand: RegistrableCommand = {
    command: agentConfigCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    agentConfig: () => fullAgentConfig,
    reloadAgentConfig: () => {
      fullAgentConfig = loadConfig();
    },
    updateConfigField,
  };
}

export type AgentConfig = Awaited<ReturnType<typeof createAgentConfig>>;
