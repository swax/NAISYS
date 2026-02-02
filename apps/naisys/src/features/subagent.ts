import {
  AgentStartRequestSchema,
  AgentStartResponse,
  AgentStopRequestSchema,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agent/agentConfig.js";
import { IAgentManager } from "../agent/agentManagerInterface.js";
import { UserService } from "../agent/userService.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import { MailService } from "../mail/mail.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";

interface Subagent {
  userId: string;
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
  localUserId: string,
  promptNotification: PromptNotificationService,
  contextManager: ContextManager,
  hubClient: HubClient,
  { globalConfig }: GlobalConfig,
) {
  const isHubMode = globalConfig().isHubMode;
  const mySubagentsMap = new Map<string, Subagent>();

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

        helpOutput += `\n\n* Use ns-mail to communicate with subagents once started`;

        return helpOutput;
      }
      case "list": {
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
          agentName: user.config.username,
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
    if (isHubMode) {
      for (const subagent of mySubagentsMap.values()) {
        if (userService.isUserActive(subagent.userId)) {
          runningAgentIds.add(subagent.userId);
        }
      }
    }

    return runningAgentIds;
  }

  function listSubagents() {
    refreshMySubagents();

    let agentList = "";

    const runningAgentIds = getRunningAgentsIds();

    const subagentRows = Array.from(mySubagentsMap.values()).map((p) => [
      p.agentName,
      runningAgentIds.has(p.userId) ? "started" : "stopped",
      p.taskDescription?.substring(0, 70) || p.title,
      inputMode.isDebug() && runningAgentIds.has(p.userId)
        ? agentManager.getBufferLineCount(p.userId).toString()
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
      const otherAgents = agentManager.runningAgents
        .filter(
          (ra) =>
            ra.agentUserId !== localUserId &&
            !mySubagentsMap.has(ra.agentUserId),
        )
        .map((ra) => {
          return {
            agentName: ra.agentUsername,
            status: "started",
            title: ra.agentTitle,
            taskDescription: "",
            unreadLines: agentManager.getBufferLineCount(ra.agentUserId),
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

  function raiseSwitchEvent() {
    promptNotification.notify({
      type: "switch",
      wake: true,
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

    let subagent = mySubagentsMap.get(user.userId);

    if (!subagent) {
      subagent = {
        userId: user.userId,
        agentName: user.config.username,
        title: user.config.title,
        taskDescription,
      };
      mySubagentsMap.set(subagent.userId, subagent);
    }

    if (isHubMode) {
      // Hub mode: send start request through hub, which routes to the target host
      const response = await hubClient.sendRequest<AgentStartResponse>(
        HubEvents.AGENT_START,
        { userId: subagent.userId, taskDescription },
      );

      if (!response.success) {
        throw `Failed to start agent via hub: ${response.error}`;
      }
    } else {
      // Non-hub mode: start agent locally
      await agentManager.startAgent(subagent.userId, (stopReason) =>
        handleAgentTermination(subagent, stopReason),
      );
    }

    subagent.taskDescription = taskDescription;

    await sendStartupMessage(subagent, taskDescription);

    return `Subagent '${agentName}' started`;
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
      throw `Agent '${agentName}' is not running`;
    }

    return userId;
  }

  async function stopAgent(agentName: string, reason: string) {
    // Also check if running in agentManager (debug user can stop agents other than local subagents)
    const userId = validateAgentRunning(agentName);

    if (!mySubagentsMap.has(userId) && !inputMode.isDebug()) {
      throw `You're not authorized to stop agent '${agentName}' directly`;
    }

    if (isHubMode) {
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
      void agentManager.stopAgent(userId, "requestShutdown", reason);
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
      type: "subagent-terminated",
      wake: !!agentConfig().wakeOnMessage,
      process: async () => {
        await contextManager.append(
          `Subagent '${subagent.agentName}' has terminated. Reason: ${reason}`,
          ContentSource.Console,
        );
      },
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

/** Register handlers for incoming AGENT_START/AGENT_STOP requests from the hub (one per NAISYS instance) */
export function registerHubAgentHandlers(
  hubClient: HubClient,
  agentManager: IAgentManager,
) {
  hubClient.registerEvent(
    HubEvents.AGENT_START,
    async (data: unknown, ack: (response: AgentStartResponse) => void) => {
      try {
        const parsed = AgentStartRequestSchema.parse(data);

        await agentManager.startAgent(parsed.userId);

        ack({ success: true });
      } catch (error) {
        ack({ success: false, error: String(error) });
      }
    },
  );

  hubClient.registerEvent(
    HubEvents.AGENT_STOP,
    async (data: unknown, ack: (response: AgentStopResponse) => void) => {
      try {
        const parsed = AgentStopRequestSchema.parse(data);

        await agentManager.stopAgent(
          parsed.userId,
          "requestShutdown",
          parsed.reason,
        );

        ack({ success: true });
      } catch (error) {
        ack({ success: false, error: String(error) });
      }
    },
  );
}
