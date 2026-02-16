import {
  AgentStartResponse,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agent/agentConfig.js";
import { IAgentManager } from "../agent/agentManagerInterface.js";
import { UserService } from "../agent/userService.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { HubClient } from "../hub/hubClient.js";
import { MailService } from "../mail/mail.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";

interface Subagent {
  userId: number;
  agentName: string;
  title: string;
  taskDescription?: string;
}

export function createSubagentService(
  { agentConfig }: AgentConfig,
  mailService: MailService,
  output: OutputService,
  agentManager: IAgentManager,
  inputMode: InputModeService,
  userService: UserService,
  localUserId: number,
  promptNotification: PromptNotificationService,
  hubClient: HubClient | undefined,
) {
  const mySubagentsMap = new Map<number, Subagent>();

  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    let errorText = "";

    switch (argv[0]) {
      case "help": {
        let helpOutput = `subagent <command>
  start <name> "<task>": Starts agent by name with a description of the task to perform
  stop <name>: Stops an agent by name`;

        if (inputMode.isDebug()) {
          helpOutput += `\n  !list: Lists all running agents`;
          helpOutput += `\n  !switch <name>: Switch context to a started in-process agent`;
          helpOutput += `\n  !flush <name>: Flush a spawned agent's output`;
        }

        helpOutput += `\n\n* Use ns-mail to communicate with subagents once started`;
        helpOutput += `\n! Debug mode only`;

        return helpOutput;
      }
      case "list": {
        if (!inputMode.isDebug()) {
          errorText =
            "The 'subagent list' command is only available in debug mode.\n";
          break;
        }

        return listSubagents();
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

        return await startAgent(subagentName, taskDescription);
      }
      case "switch": {
        if (!inputMode.isDebug()) {
          errorText =
            "The 'subagent switch' command is only available in debug mode.\n";
          break;
        }

        const switchName = argv[1];
        return switchAgent(switchName);
      }
      case "stop": {
        const stopName = argv[1];
        return await stopAgent(stopName, "subagent stop");
      }
      default: {
        errorText = "Error, unknown command. See valid commands below:\n";
      }
    }

    return errorText + (await handleCommand("help"));
  }

  function refreshMySubagents() {
    const allUsers = userService.getUsers();

    for (const user of allUsers) {
      if (user.userId === localUserId) continue; // Exclude self

      // Only include agents led by this user
      if (user.leadUserId != localUserId) continue;

      const existing = mySubagentsMap.get(user.userId);
      if (!existing) {
        mySubagentsMap.set(user.userId, {
          userId: user.userId,
          agentName: user.username,
          title: user.config.title,
        });
      }
    }
  }

  /** Returns IDs of running agents. In hub mode, includes remote agents via heartbeat status. */
  function getRunningAgentsIds() {
    const runningAgentIds = new Set(
      agentManager.runningAgents.map((a) => a.agentUserId),
    );

    // In hub mode, also include agents reported active by the hub heartbeat
    if (hubClient) {
      for (const subagent of mySubagentsMap.values()) {
        if (userService.isUserActive(subagent.userId)) {
          runningAgentIds.add(subagent.userId);
        }
      }
    }

    return runningAgentIds;
  }

  function listSubagents() {
    const allUsers = userService.getUsers();
    const activeUsers = allUsers.filter((u) =>
      userService.isUserActive(u.userId),
    );

    if (activeUsers.length === 0) {
      return "No active agents.";
    }

    const runningAgentIds = new Set(
      agentManager.runningAgents.map((a) => a.agentUserId),
    );

    const rows = activeUsers.map((u) => {
      const subagent = mySubagentsMap.get(u.userId);
      const unreadLines = runningAgentIds.has(u.userId)
        ? agentManager.getBufferLineCount(u.userId).toString()
        : "";
      return [
        u.username,
        subagent?.taskDescription?.substring(0, 70) || u.config.title,
        userService.getUserHostDisplayNames(u.userId).join(", ") || "",
        unreadLines,
      ];
    });

    return table([["Name", "Task", "Host", "Unread Lines"], ...rows], {
      hsep: " | ",
    });
  }

  function raiseSwitchEvent() {
    promptNotification.notify({
      userId: localUserId,
      wake: "always",
    });
  }

  function validateUser(agentName: string) {
    const user = userService.getUserByName(agentName);
    if (!user) {
      throw `Agent '${agentName}' not found`;
    }
    return user;
  }

  function validateSubagentStart(agentName: string, taskDescription: string) {
    if (!agentName) {
      throw "Subagent name is required to start a subagent";
    }

    if (!taskDescription) {
      throw "Task description is required to start a subagent";
    }

    const user = validateUser(agentName);

    const subagent = mySubagentsMap.get(user.userId);

    if (!inputMode.isDebug() && !subagent) {
      throw "You're not authorized to start this subagent directly";
    }

    const runningAgentIds = getRunningAgentsIds();

    if (runningAgentIds.has(user.userId)) {
      throw `Subagent '${agentName}' is already running`;
    }

    return user;
  }

  async function startAgent(agentName: string, taskDescription: string) {
    refreshMySubagents();

    const user = validateSubagentStart(agentName, taskDescription);

    let resultMessage = "";

    let subagent = mySubagentsMap.get(user.userId);

    if (!subagent) {
      subagent = {
        userId: user.userId,
        agentName: user.username,
        title: user.config.title,
        taskDescription,
      };
      mySubagentsMap.set(subagent.userId, subagent);
    }

    if (hubClient) {
      // Hub mode: send start request through hub, which routes to the target host
      const response = await hubClient.sendRequest<AgentStartResponse>(
        HubEvents.AGENT_START,
        { userId: subagent.userId, taskDescription },
      );

      if (!response.success) {
        throw `Failed to start agent via hub: ${response.error}`;
      }

      resultMessage = `Subagent '${agentName}' started on host '${response.hostname}'`;
    }
    // Non-hub mode: start agent locally
    else {
      await agentManager.startAgent(subagent.userId, (stopReason) =>
        handleAgentTermination(subagent, stopReason),
      );
      resultMessage = `Subagent '${agentName}' started`;
    }

    subagent.taskDescription = taskDescription;

    await sendStartupMessage(subagent, taskDescription);

    return resultMessage;
  }

  async function sendStartupMessage(
    subagent: Subagent,
    taskDescription: string,
  ) {
    return await mailService
      .sendMessage([subagent.agentName], "Your Task", taskDescription)
      .catch(async () => {
        await output.commentAndLog(
          `Failed to send initial task email to subagent ${subagent.agentName}`,
        );
      });
  }

  function validateAgentRunning(agentName: string) {
    const user = validateUser(agentName);
    const userId = user.userId;

    if (!getRunningAgentsIds().has(userId)) {
      if (userService.isUserActive(userId)) {
        throw `Agent '${agentName}' is active, but not on this host`;
      } else {
        throw `Agent '${agentName}' is not running`;
      }
    }

    return userId;
  }

  async function stopAgent(agentName: string, reason: string) {
    // Also check if running in agentManager (debug user can stop agents other than local subagents)
    const userId = validateAgentRunning(agentName);

    if (!mySubagentsMap.has(userId) && !inputMode.isDebug()) {
      throw `You're not authorized to stop agent '${agentName}' directly`;
    }

    if (hubClient) {
      // Hub mode: send stop request through hub, which routes to the agent's host
      const response = await hubClient.sendRequest<AgentStopResponse>(
        HubEvents.AGENT_STOP,
        { userId, reason },
      );

      if (!response.success) {
        throw `Failed to stop agent via hub: ${response.error}`;
      }
    } else {
      // Non-hub mode: stop agent locally
      void agentManager.stopAgent(userId, reason);
    }

    return `Agent '${agentName}' stop requested`;
  }

  /** Stop all running subagents */
  function cleanup(reason: string) {
    const runningAgentIds = getRunningAgentsIds();
    mySubagentsMap.forEach((subagent) => {
      if (runningAgentIds.has(subagent.userId)) {
        void stopAgent(subagent.agentName, reason).catch(() => {});
      }
    });
  }

  /** Only for in-process agents */
  function switchAgent(agentName: string) {
    const userId = validateAgentRunning(agentName);

    agentManager.setActiveConsoleAgent(userId);

    return "";
  }

  function handleAgentTermination(subagent: Subagent, reason: string) {
    subagent.taskDescription = undefined;

    promptNotification.notify({
      userId: localUserId,
      wake: "yes",
      contextOutput: [
        `Subagent '${subagent.agentName}' has terminated. Reason: ${reason}`,
      ],
    });
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-agent",
    helpText: "Spawn and manage subagents",
    handleCommand,
  };

  return {
    ...registrableCommand,
    cleanup,
    raiseSwitchEvent,
  };
}

export type SubagentService = ReturnType<typeof createSubagentService>;
