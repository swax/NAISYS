import type { AgentConfigFile } from "@naisys/common";
import { HubEvents } from "@naisys/hub-protocol";
import stringArgv from "string-argv";
import stripAnsi from "strip-ansi";
import table from "text-table";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { IAgentManager } from "../agent/agentManagerInterface.js";
import type { UserService } from "../agent/userService.js";
import { subagentCmd } from "../command/commandDefs.js";
import type { RegistrableCommand } from "../command/commandRegistry.js";
import type { HubClient } from "../hub/hubClient.js";
import type { CostTracker } from "../llm/costTracker.js";
import type { MailService } from "../mail/mail.js";
import type { RunService } from "../services/runService.js";
import { agentNames } from "../utils/agentNames.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";

interface Subagent {
  userId: number;
  agentName: string;
  title: string;
  taskDescription?: string;
  isEphemeral?: boolean;
}

export function createSubagentService(
  mailService: MailService,
  output: OutputService,
  agentManager: IAgentManager,
  inputMode: InputModeService,
  userService: UserService,
  localUserId: number,
  promptNotification: PromptNotificationService,
  hubClient: HubClient | undefined,
  agentConfig: AgentConfig,
  runService: RunService,
  costTracker: CostTracker,
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
        const subs = subagentCmd.subcommands!;
        let helpOutput = `${subagentCmd.name} <command>
  ${subs.list.usage}: ${subs.list.description}
  ${subs.create.usage}: ${subs.create.description}
  ${subs.start.usage}: ${subs.start.description}
  ${subs.stop.usage}: ${subs.stop.description}
  ${subs.peek.usage}: ${subs.peek.description}`;

        if (inputMode.isDebug()) {
          helpOutput += `\n\nDebug commands:`;
          helpOutput += `\n  ${subs.local.usage}: ${subs.local.description}`;
          helpOutput += `\n  ${subs.switch.usage}: ${subs.switch.description}`;
        }

        helpOutput += `\n\n* Use ns-chat to communicate with subagents once started`;

        return helpOutput;
      }
      case "list": {
        return listMySubagents();
      }
      case "local": {
        if (!inputMode.isDebug()) {
          errorText =
            "The 'subagent local' command is only available in debug mode.\n";
          break;
        }

        return listLocalAgents();
      }
      // "spawn" command removed - launched agents as separate child node processes. See git history.
      case "create": {
        const title = argv[1];
        const taskDescription = argv[2];

        if (!title || !taskDescription) {
          errorText =
            'Missing required parameters. Expected: create "<title>" "<task>"\n';
          break;
        }

        return await createEphemeralSubagent(title, taskDescription);
      }
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
      case "peek": {
        const peekName = argv[1];
        const skip = argv[2] ? parseInt(argv[2], 10) : undefined;
        const take = argv[3] ? parseInt(argv[3], 10) : undefined;
        return await peekAgent(peekName, skip, take);
      }
      case "stop": {
        const recursive = argv[1] === "-r";
        const username = recursive ? argv[2] : argv[1];
        const recursiveText = recursive ? " (recursive)" : "";

        return await stopAgent(
          username,
          "subagent stop" + recursiveText,
          recursive,
        );
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

  /** Returns IDs of running agents. In hub mode, includes remote agents via agent status. */
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

  function listMySubagents() {
    refreshMySubagents();

    if (mySubagentsMap.size === 0) {
      return "No subagents.";
    }

    const runningAgentIds = getRunningAgentsIds();

    const rows = [...mySubagentsMap.values()].map((subagent) => {
      const running = runningAgentIds.has(subagent.userId);
      return [
        subagent.agentName,
        subagent.taskDescription?.substring(0, 70) || subagent.title,
        running ? "running" : "stopped",
      ];
    });

    return table([["Name", "Task", "Status"], ...rows], {
      hsep: " | ",
    });
  }

  function listLocalAgents() {
    if (agentManager.runningAgents.length === 0) {
      return "No locally running agents.";
    }

    const rows = agentManager.runningAgents.map((a) => {
      return [a.agentUsername, "Running"];
    });

    return table([["Name", "Status"], ...rows], {
      hsep: " | ",
    });
  }

  function raiseSwitchEvent() {
    promptNotification.notify({
      userId: localUserId,
      wake: "always",
    });
  }

  /** Check if targetUserId is a subordinate of localUserId at any depth */
  function isSubordinate(targetUserId: number): boolean {
    let current = userService.getUserById(targetUserId);
    const visited = new Set<number>();
    while (current?.leadUserId != null) {
      if (current.leadUserId === localUserId) return true;
      if (visited.has(current.leadUserId)) return false; // cycle guard
      visited.add(current.leadUserId);
      current = userService.getUserById(current.leadUserId);
    }
    return false;
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

    if (!user.enabled) {
      throw `Agent '${agentName}' is disabled`;
    }

    if (!inputMode.isDebug() && !isSubordinate(user.userId)) {
      throw "You're not authorized to start this agent — not your subordinate";
    }

    const runningAgentIds = getRunningAgentsIds();

    if (runningAgentIds.has(user.userId)) {
      throw `Subagent '${agentName}' is already running`;
    }

    return user;
  }

  async function createEphemeralSubagent(
    title: string,
    taskDescription: string,
  ) {
    if (userService.getUserById(localUserId)?.isEphemeral) {
      throw "Subagents cannot create their own subagents";
    }

    const existingNames = new Set(
      userService.getUsers().map((u) => u.username),
    );
    const shuffled = [...agentNames].sort(() => Math.random() - 0.5);
    const agentName = shuffled.find((n) => !existingNames.has(n));

    if (!agentName) {
      throw "No available usernames for subagents";
    }

    const subagentUserId = userService.nextSyntheticUserId();
    const parentConfig = agentConfig.agentConfig();
    const leadAgent = parentConfig.username;

    const subagentConfig: AgentConfigFile = {
      username: agentName,
      title,
      agentPrompt:
        `You are \${agent.username}, a \${agent.title} working for ${leadAgent}.\n` +
        `Task: ${taskDescription}\n` +
        `Complete the task and/or wait for follow-up messages from ${leadAgent}. ` +
        `When finished, use ns-session to end your session.`,
      commandProtection:
        parentConfig.commandProtection == "auto" ? "auto" : "none",
      wakeOnMessage: true,
      completeSessionEnabled: true,
      // spendLimitDollars omitted: subagent defers checkSpendLimit to parent.
      // spendLimitHours kept: drives ns-cost period display.
      spendLimitHours: parentConfig.spendLimitHours,
      shellModel: parentConfig.shellModel,
      imageModel: parentConfig.imageModel,
      tokenMax: parentConfig.tokenMax,
      webEnabled: parentConfig.webEnabled,
      mailEnabled: parentConfig.mailEnabled,
      chatEnabled: parentConfig.chatEnabled,
      browserEnabled: parentConfig.browserEnabled,
      multipleCommandsEnabled: parentConfig.multipleCommandsEnabled,
    };

    userService.addLocalUser({
      userId: subagentUserId,
      username: agentName,
      enabled: true,
      leadUserId: localUserId,
      config: subagentConfig,
      isEphemeral: true,
    });

    const subagent: Subagent = {
      userId: subagentUserId,
      agentName,
      title,
      taskDescription,
      isEphemeral: true,
    };
    mySubagentsMap.set(subagentUserId, subagent);

    try {
      await agentManager.startAgent(
        subagentUserId,
        (stopReason) => handleAgentTermination(subagent, stopReason),
        undefined,
        {
          parentUserId: localUserId,
          parentRunId: runService.getRunId(),
          subagentId: subagentUserId,
          parentCostTracker: costTracker,
        },
      );
    } catch (error) {
      userService.removeLocalUser(subagentUserId);
      mySubagentsMap.delete(subagentUserId);
      throw error;
    }

    await sendStartupMessage(subagent, taskDescription);

    return `Subagent '${agentName}' (${title}) created and started`;
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
      const response = await hubClient.sendRequest(HubEvents.AGENT_START, {
        startUserId: subagent.userId,
        requesterUserId: localUserId,
        taskDescription,
      });

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

    // In non-hub mode, send mail locally; in hub mode, the hub sends it from the AGENT_START handler
    if (!hubClient) {
      await sendStartupMessage(subagent, taskDescription);
    }

    return resultMessage;
  }

  async function sendStartupMessage(
    subagent: Subagent,
    taskDescription: string,
  ) {
    const recipients = userService.resolveUsernames(subagent.agentName);
    return await mailService
      .sendMessage(recipients, "Your Task", taskDescription)
      .catch(() => {
        output.commentAndLog(
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

  /** Find all running subordinates of a user (recursively) */
  function findRunningSubordinates(parentUserId: number): number[] {
    const allUsers = userService.getUsers();
    const runningAgentIds = getRunningAgentsIds();
    const result: number[] = [];

    function collect(parentId: number) {
      for (const user of allUsers) {
        if (user.leadUserId === parentId && runningAgentIds.has(user.userId)) {
          result.push(user.userId);
          collect(user.userId);
        }
      }
    }
    collect(parentUserId);

    return result;
  }

  async function stopAgent(
    agentName: string,
    reason: string,
    recursive?: boolean,
  ) {
    // Also check if running in agentManager (debug user can stop agents other than local subagents)
    const userId = validateAgentRunning(agentName);

    if (!inputMode.isDebug() && !isSubordinate(userId)) {
      throw `You're not authorized to stop agent '${agentName}' — not your subordinate`;
    }

    // Collect subordinate IDs before stopping the parent
    const subordinateIds = recursive ? findRunningSubordinates(userId) : [];

    // Ephemerals are local-only — the hub doesn't know their synthetic ids,
    // so route each target per its own ephemerality (a non-ephemeral parent
    // can have ephemeral children).
    const isHubRouted = (targetId: number) =>
      !!hubClient && !userService.getUserById(targetId)?.isEphemeral;

    if (isHubRouted(userId)) {
      // Confirm the hub accepted the parent stop so failures surface to the caller
      const response = await hubClient!.sendRequest(HubEvents.AGENT_STOP, {
        userId,
        reason,
      });
      if (!response.success) {
        throw `Failed to stop agent via hub: ${response.error}`;
      }
    } else {
      // Local stop awaits the agent's actual shutdown (up to 10s) — fire-and-forget
      void agentManager.stopAgent(userId, reason);
    }

    // Subordinates fire-and-forget; route each per its own ephemerality
    void Promise.all(
      subordinateIds.map((subId) =>
        isHubRouted(subId)
          ? hubClient!
              .sendRequest(HubEvents.AGENT_STOP, { userId: subId, reason })
              .catch(() => {})
          : agentManager.stopAgent(subId, reason).catch(() => {}),
      ),
    );

    const stoppedCount = subordinateIds.length + 1;
    return recursive && stoppedCount > 1
      ? `Stop requested for '${agentName}' and ${stoppedCount - 1} subordinate(s)`
      : `Agent '${agentName}' stop requested`;
  }

  /** Only for in-process agents */
  function switchAgent(agentName: string) {
    const userId = validateAgentRunning(agentName);

    agentManager.setActiveConsoleAgent(userId);

    return "";
  }

  async function peekAgent(agentName: string, skip?: number, take?: number) {
    const userId = validateAgentRunning(agentName);

    if (!inputMode.isDebug() && !isSubordinate(userId)) {
      throw `You're not authorized to peek at agent '${agentName}' — not your subordinate`;
    }

    const isEphemeral = userService.getUserById(userId)?.isEphemeral;

    let lines: string[];
    let totalLines: number;

    if (hubClient && !isEphemeral) {
      const response = await hubClient.sendRequest(HubEvents.AGENT_PEEK, {
        userId,
        skip,
        take,
      });

      if (!response.success) {
        throw `Failed to peek agent via hub: ${response.error}`;
      }

      lines = response.lines ?? [];
      totalLines = response.totalLines ?? 0;
    } else {
      // Local mode: get buffer lines directly
      const allLines = agentManager
        .getBufferLines(userId)
        .map((line) => stripAnsi(line));
      totalLines = allLines.length;

      const s = skip ?? 0;
      const t = take ?? totalLines;
      lines = allLines.slice(s, s + t);
    }

    if (lines.length === 0) {
      return `No buffered output for '${agentName}'.`;
    }

    return (
      `[${lines.length} of ${totalLines} lines]\n` +
      lines.map((l) => "  " + l).join("\n")
    );
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

    if (subagent.isEphemeral) {
      userService.removeLocalUser(subagent.userId);
      mySubagentsMap.delete(subagent.userId);
    }
  }

  const registrableCommand: RegistrableCommand = {
    command: subagentCmd,
    handleCommand,
  };

  async function cleanup() {
    const stopPromises = [...mySubagentsMap.values()]
      .filter((sub) => sub.isEphemeral)
      .map((sub) =>
        agentManager.stopAgent(sub.userId, "parent terminated").catch((err) => {
          output.errorAndLog(
            `Failed to stop ephemeral subagent ${sub.agentName}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      );
    await Promise.all(stopPromises);
  }

  return {
    ...registrableCommand,
    raiseSwitchEvent,
    cleanup,
  };
}

export type SubagentService = ReturnType<typeof createSubagentService>;
