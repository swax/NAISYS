import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agent/agentConfig.js";
import { IAgentRunner } from "../agent/agentRunnerInterface.js";
import { UserService } from "../agent/userService.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import { MailService } from "../mail/mail.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";

interface Subagent {
  userId: string;
  agentName: string;
  title: string;
  taskDescription?: string;
  log: string[];
  status: "started" | "stopped";
}

export function createSubagentService(
  { agentConfig }: AgentConfig,
  mailService: MailService,
  output: OutputService,
  agentRunner: IAgentRunner,
  inputMode: InputModeService,
  userService: UserService,
  localUserId: string,
  promptNotification: PromptNotificationService,
  contextManager: ContextManager,
) {
  const _subagents: Subagent[] = [];

  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    let errorText = "";

    switch (argv[0]) {
      case "help": {
        let helpOutput = `subagent <command>
  list: Lists all startable and started agents
  start <name> "<task>": Starts agent by name with a description of the task to perform
  stop <name>: Stops an agent by name`;

        if (inputMode.isDebug()) {
          helpOutput += `\n  switch <name>: Switch context to a started in-process agent (debug mode only)`;
          helpOutput += `\n  flush <name>: Flush a spawned agent's output (debug mode only)`;
        }

        if (agentConfig().mailEnabled) {
          helpOutput += `\n\n* Use ns-mail to communicate with subagents once started`;
        }

        return helpOutput;
      }
      case "list": {
        return buildAgentList();
      }
      // "create" command removed - generated agent yaml configs from a template and wrote them to disk. See git history.
      // "spawn" command removed - launched agents as separate child node processes. See git history.
      case "start": {
        const subagentName = argv[1];
        const taskDescription = argv[2];

        if (!subagentName || !taskDescription) {
          errorText =
            'Missing required parameters. Expected: start <username> "<description>"\n';
          break;
        }

        return await _startAgent(subagentName, taskDescription);
      }
      case "switch": {
        if (!inputMode.isDebug()) {
          errorText =
            "The 'subagent switch' command is only available in debug mode.\n";
          break;
        }

        const switchName = argv[1];
        return _switchAgent(switchName);
      }
      case "stop": {
        const stopName = argv[1];
        return _stopAgent(stopName, "subagent stop");
      }
      case "flush": {
        const flushName = argv[1];
        _debugFlushContext(flushName);
        return "";
      }
      default: {
        errorText = "Error, unknown command. See valid commands below:\n";
      }
    }

    return errorText + (await handleCommand("help"));
  }

  function refreshSubagents() {
    const allUsers = userService.getUsers();
    const currentUsername = agentConfig().username;

    for (const [username, entry] of allUsers) {
      if (username === localUserId) continue; // Exclude self

      // Only include agents led by this user, or agents with no lead (available to all)
      const leadAgent = entry.config.leadAgent;
      if (leadAgent !== undefined && leadAgent !== currentUsername) continue;

      const existing = _subagents.find((p) => p.agentName === username);
      if (!existing) {
        _subagents.push({
          userId: username,
          agentName: username,
          title: entry.config.title,
          log: [],
          status: "stopped",
        });
      }
    }
  }

  function buildAgentList() {
    refreshSubagents();

    let agentList = "";

    const isRunning = (p: Subagent) => p.status === "started";

    const subagentRows = _subagents.map((p) => [
      p.agentName,
      p.status,
      p.taskDescription?.substring(0, 70) || p.title,
      inputMode.isDebug() && isRunning(p)
        ? (p.log.length || agentRunner.getBufferLines(p.userId)).toString()
        : "",
    ]);

    if (subagentRows.length === 0) {
      agentList += "No subagents found.";
    } else {
      agentList += table(
        [
          ["Name", "Status", "Task", inputMode.isDebug() ? "Unread Lines" : ""],
          ...subagentRows,
        ],
        { hsep: " | " },
      );
    }

    if (inputMode.isDebug()) {
      // Find running in process agents that aren't already listed
      const otherAgents = agentRunner.runningAgents
        .filter(
          (ra) =>
            ra.agentUserId !== localUserId &&
            !_subagents.find((sa) => sa.userId === ra.agentUserId),
        )
        .map((ra) => {
          return {
            agentName: ra.agentUsername,
            status: "started",
            title: ra.agentTitle,
            taskDescription: ra.agentTaskDescription,
            unreadLines: agentRunner.getBufferLines(ra.agentUserId),
          };
        });

      if (otherAgents.length > 0) {
        agentList += "\n\nOther In-Process Running Agents:\n";

        agentList += table(
          [
            ["Name", "Status", "Task", "Unread Lines"],
            ...otherAgents.map((p) => [
              p.agentName,
              p.status,
              p.taskDescription?.substring(0, 70) || p.title,
              p.unreadLines.toString(),
            ]),
          ],
          { hsep: " | " },
        );
      }
    }

    return agentList;
  }

  function getRunningSubagentNames() {
    return _subagents
      .filter((p) => p.status !== "stopped")
      .map((p) => p.agentName);
  }

  function raiseSwitchEvent() {
    promptNotification.notify({
      type: "switch",
      wake: true,
    });
  }

  /** Look up user by username in the user service */
  function lookupUser(identifier: string) {
    // Parse username@host format (host part ignored - no host concept on runner)
    const atIndex = identifier.lastIndexOf("@");
    const username = atIndex > 0 ? identifier.slice(0, atIndex) : identifier;

    return userService.getUserById(username) ?? null;
  }

  function validateLocalAgentStart(agentName: string, taskDescription: string) {
    if (!agentName) {
      throw "Subagent name is required to start a subagent";
    }

    if (!taskDescription) {
      throw "Task description is required to start a subagent";
    }

    const subagent = _subagents.find((p) => p.agentName === agentName);
    if (!subagent) {
      return null; // Not found locally, may be remote
    }

    if (subagent.status !== "stopped") {
      throw `Subagent '${agentName}' is already running`;
    }

    return subagent;
  }

  async function _startAgent(agentName: string, taskDescription: string) {
    if (!agentName) {
      throw "Subagent name is required to start a subagent";
    }
    if (!taskDescription) {
      throw "Task description is required to start a subagent";
    }

    // First refresh the subagents list
    refreshSubagents();

    // Try to validate as a local agent start
    const localSubagent = validateLocalAgentStart(agentName, taskDescription);

    if (localSubagent) {
      // Start the agent
      await agentRunner.startAgent(localSubagent.userId, (stopReason) =>
        handleAgentTermination(localSubagent, stopReason),
      );

      localSubagent.taskDescription = taskDescription;
      localSubagent.status = "started";

      await sendStartupMessage(localSubagent, taskDescription);

      return `Subagent '${agentName}' started`;
    }

    // Not in subagents list - check if the user exists at all
    const user = lookupUser(agentName);
    if (!user) {
      throw `Agent '${agentName}' not found`;
    }

    // User exists but is not a subagent of this agent
    throw `Agent '${agentName}' exists but is not a subagent of ${agentConfig().username}`;
  }

  async function sendStartupMessage(
    subagent: Subagent,
    taskDescription: string,
  ) {
    if (!agentConfig().mailEnabled) {
      return;
    }

    return await mailService
      .sendMessage([subagent.agentName], "Your Task", taskDescription)
      .catch(async () => {
        await output.commentAndLog(
          `Failed to send initial task email to subagent ${subagent.agentName}`,
        );
      });
  }

  function _stopAgent(agentName: string, reason: string) {
    // Find by name in local subagents
    const subagent = _subagents.find((p) => p.agentName === agentName);

    // Also check if running in agentRunner (debug user can stop agents other than local subagents)
    const agentRuntime = agentRunner.runningAgents.find(
      (a) => a.agentUsername === agentName,
    );

    if (!subagent && !agentRuntime) {
      throw `Agent '${agentName}' not found`;
    }

    if (subagent?.status === "stopped") {
      throw `Agent '${agentName}' is already stopped`;
    }

    if (agentRuntime) {
      // Request shutdown of in-process agent, callback defined in start() will handle termination event
      void agentRunner.stopAgent(
        agentRuntime.agentUserId,
        "requestShutdown",
        reason,
      );
    }

    return `Agent '${agentName}' stop requested`;
  }

  /** Stop all running subagents */
  function cleanup(reason: string) {
    _subagents.forEach((subagent) => {
      if (subagent.status === "started") {
        try {
          _stopAgent(subagent.agentName, reason);
        } catch {}
      }
    });
  }

  /** Only for in-process agents */
  function _switchAgent(agentName: string) {
    const agentRuntime = agentRunner.runningAgents.find(
      (a) => a.agentUsername === agentName,
    );

    if (!agentRuntime) {
      throw `Agent '${agentName}' is not running`;
    }

    agentRunner.setActiveConsoleAgent(agentRuntime.agentUserId);

    return "";
  }

  function handleAgentTermination(subagent: Subagent, reason: string) {
    subagent.status = "stopped";
    subagent.taskDescription = undefined;

    promptNotification.notify({
      type: "subagent-terminated",
      wake: agentConfig().wakeOnMessage,
      process: async () => {
        await contextManager.append(
          `Subagent '${subagent.agentName}' has terminated. Reason: ${reason}`,
          ContentSource.Console,
        );
      },
    });
  }

  /** Only used in debug mode, not by LLM */
  function _debugFlushContext(agentName: string) {
    const subagent = _subagents.find((p) => p.agentName === agentName);
    if (!subagent) {
      throw `Agent '${agentName}' not found`;
    }

    if (subagent.status == "started") {
      throw `Agent '${agentName}' is not a spawned subagent, use the switch command to see output.`;
    }

    subagent.log.forEach((line) => output.write(line, OutputColor.subagent));

    subagent.log.length = 0;
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-agent",
    helpText: "Spawn and manage subagents",
    handleCommand,
  };

  return {
    ...registrableCommand,
    getRunningSubagentNames,
    cleanup,
    raiseSwitchEvent,
  };
}

export type SubagentService = ReturnType<typeof createSubagentService>;
