import { DatabaseService } from "@naisys/database";
import { ChildProcess } from "child_process";
import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agent/agentConfig.js";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { RemoteAgentRequester } from "../hub/remoteAgentRequester.js";
import { HostService } from "../services/hostService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import { LLMail } from "./llmail.js";

interface Subagent {
  userId: string;
  agentName: string;
  title: string;
  taskDescription?: string;
  process?: ChildProcess;
  log: string[];
  status: "spawned" | "started" | "stopped";
}

/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
type IAgentManager = {
  startAgent: (
    userId: string,
    onStop?: (reason: string) => void,
  ) => Promise<string>;
  stopAgent: (
    agentUserId: string,
    mode: "requestShutdown" | "completeShutdown",
    reason: string,
  ) => Promise<void>;
  runningAgents: Array<{
    agentUserId: string;
    agentUsername: string;
    agentTitle: string;
    agentTaskDescription?: string;
  }>;
  getBufferLines: (agentUserId: string) => number;
  setActiveConsoleAgent: (agentUserId: string) => void;
};

export function createSubagentService(
  { agentConfig }: AgentConfig,
  llmail: LLMail,
  output: OutputService,
  agentManager: IAgentManager,
  inputMode: InputModeService,
  { usingDatabase }: DatabaseService,
  { localHostId }: HostService,
  remoteAgentRequester: RemoteAgentRequester,
  userId: string,
) {
  const _subagents: Subagent[] = [];

  // Track running subagents and termination events
  const _terminationEvents: Array<{
    userId: string;
    agentName: string;
    reason: string;
  }> = [];

  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    let errorText = "";

    switch (argv[0]) {
      case "help": {
        let helpOutput = `subagent <command>
  list: Lists all subagents
  stop <name>: Stops the agent with the given name
  start <name> "<description>": Starts an existing agent with the given name and description of the task to perform`;

        //  create "<agent title>" "<description>": Creates a new agent. Include as much detail in the description as possible.
        //  spawn <username> <description>: Spawns the agent as a separate isolated node process (generally use start instead)

        if (inputMode.isDebug()) {
          helpOutput += `\n  switch <name>: Switch context to a started in-process agent (debug mode only)`;
          helpOutput += `\n  flush <name>: Flush a spawned agent's output (debug mode only)`;
        }

        if (agentConfig().mailEnabled) {
          helpOutput += `\n\n* Use ns-mail to communicate with subagents by name.`;
        }

        return helpOutput;
      }
      case "list": {
        return await buildAgentList();
      }
      /*case "create": {
        const title = argv[1];
        const task = argv[2];

        // Validate title and task set
        if (!title || !task) {
          errorText = "See valid 'create' syntax below:\n";
          break;
        }

        return await _createAgent(title, task);
      }*/
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
      /*case "spawn": {
        const subagentName = argv[1];
        const taskDescription = argv[2];

        return await _spawnAgent(subagentName, taskDescription);
      }*/
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

  async function refreshSubagents() {
    await usingDatabase(async (prisma) => {
      const agents = await prisma.users.findMany({
        where: {
          OR: [
            { lead_user_id: userId },
            { lead_user_id: null }, // Include agents with no lead (available to all)
          ],
          host_id: localHostId,
          deleted_at: null, // Only show active subagents
          id: { not: userId }, // Exclude self from subagent list
        },
      });

      agents.forEach((agent) => {
        const existing = _subagents.find((p) => p.agentName === agent.username);
        if (!existing) {
          _subagents.push({
            userId: agent.id,
            agentName: agent.username,
            title: agent.title,
            log: [],
            status: "stopped",
          });
        }
      });
    });
  }

  async function buildAgentList() {
    await refreshSubagents();

    let agentList = "";

    const isRunning = (p: Subagent) => p.status === "started";

    const subagentRows = _subagents.map((p) => [
      p.agentName,
      p.status,
      p.taskDescription?.substring(0, 70) || p.title,
      inputMode.isDebug() && isRunning(p)
        ? (p.log.length || agentManager.getBufferLines(p.userId)).toString()
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
            ra.agentUserId !== userId &&
            !_subagents.find((sa) => sa.userId === ra.agentUserId),
        )
        .map((ra) => {
          return {
            agentName: ra.agentUsername,
            status: "started",
            title: ra.agentTitle,
            taskDescription: ra.agentTaskDescription,
            unreadLines: agentManager.getBufferLines(ra.agentUserId),
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

  /** Check for and clear termination events for wake notifications */
  function getTerminationEvents(
    action?: "clear",
  ): Array<{ userId: string; agentName: string; reason: string }> {
    if (_terminationEvents.length === 0) {
      return [];
    }

    const events = [..._terminationEvents];

    if (action === "clear") {
      _terminationEvents.length = 0;
    }

    return events;
  }

  let switchEventRaised = false;

  function raiseSwitchEvent() {
    switchEventRaised = true;
  }
  function switchEventTriggered(action?: "clear") {
    const wasRaised = switchEventRaised;
    if (action === "clear") {
      switchEventRaised = false;
    }
    return wasRaised;
  }

  /**
   * Not sure if we should have this, or tell the AI how to create a real agent file
   * Or have a first class 'temp' agent that supports starting multiple instances with different tasks
   * As we do support multiple concurrent runtime ids now for logs/costs
   * Dont want to hose the user table to a ton of temp user names
   */
  /*async function _createAgent(title: string, taskDescription: string) {
    // Get available username
    const usernames = await llmail.getAllUserNames();
    let agentName = "";

    const shuffledNames = shuffle(agentNames);

    for (const name of shuffledNames) {
      if (!usernames.includes(name)) {
        agentName = name;
        break;
      }
    }

    if (!agentName) {
      throw "No available usernames for subagents";
    }

    // Generate agent yaml
    const subagentConfig: Partial<AgentConfigFile> = {
      ...agentConfig,
      username: agentName,
      title,
      agentPrompt:
        `You are \${agent.username} a \${agent.title} with the job of helping out the \${agent.leadAgent} with what they want to do.\n` +
        `Task Description: \${agent.taskDescription}\n` +
        `Perform the above task and/or wait for messages from \${agent.leadAgent} and respond to them.` +
        `When completed use the 'completeTask' command to signal that you are done.`,
      wakeOnMessage: true,
      completeTaskEnabled: true,
      leadAgent: agentConfig().username,
      mailEnabled: true, // Needed to communicate the task completion message
      taskDescription,
    };

    if (agentConfig().mailEnabled) {
      subagentConfig.mailEnabled = true;
      subagentConfig.initialCommands = ["ns-mail users", "ns-mail help"];
    }

    const agentYaml = yaml.dump(subagentConfig);

    // write agent yaml to file
    const subagentDir = _getSubagentDir();
    const agentHostPath = path.join(
      subagentDir.toHostPath(),
      `${agentName}.yaml`,
    );
    const agentPath = new NaisysPath(agentHostPath);

    pathService.ensureFileDirExists(agentPath);

    fs.writeFileSync(agentHostPath, agentYaml);

    _subagents.push({
      agentName,
      agentPath,
      taskDescription,
      log: [],
      status: "stopped",
    });

    return "Subagent Created. Ready to start or spawn";
  }*/

  /** Look up user by username, returning host and agent info */
  async function lookupUser(identifier: string) {
    // Parse username@host format
    const atIndex = identifier.lastIndexOf("@");
    let username: string;
    let hostName: string | null = null;

    if (atIndex > 0) {
      username = identifier.slice(0, atIndex);
      hostName = identifier.slice(atIndex + 1);
    } else {
      username = identifier;
    }

    return await usingDatabase(async (prisma) => {
      const matchingUsers = await prisma.users.findMany({
        where: {
          username,
          deleted_at: null,
          ...(hostName ? { host: { name: hostName } } : {}),
        },
        select: {
          id: true,
          username: true,
          host_id: true,
          agent_path: true,
          host: { select: { name: true } },
        },
      });

      if (matchingUsers.length === 0) {
        return null;
      }

      if (matchingUsers.length === 1) {
        return matchingUsers[0];
      }

      // Multiple users with same username - try to find one on localhost
      const localUser = matchingUsers.find((u) => u.host_id === localHostId);
      if (localUser) {
        return localUser;
      }

      // No local user and multiple matches - require username@host
      const hostOptions = matchingUsers
        .map((u) => `${u.username}@${u.host?.name || "unknown"}`)
        .join(", ");
      throw `Multiple users named '${username}' exist. Use one of: ${hostOptions}`;
    });
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

    // First refresh the local subagents list
    await refreshSubagents();

    // Try to validate as a local agent start
    const localSubagent = validateLocalAgentStart(agentName, taskDescription);

    if (localSubagent) {
      // Local agent - start the agent
      await agentManager.startAgent(localSubagent.userId, (stopReason) =>
        handleAgentTermination(localSubagent, stopReason),
      );

      localSubagent.taskDescription = taskDescription;
      localSubagent.status = "started";

      await sendStartupMessage(localSubagent, taskDescription);

      return `Subagent '${agentName}' started`;
    }

    // Not found locally - look up in database (might be remote)
    const user = await lookupUser(agentName);
    if (!user) {
      throw `Agent '${agentName}' not found`;
    }

    // Check if this is a local agent that wasn't in our subagents list
    if (user.host_id === localHostId) {
      throw `Agent '${agentName}' exists locally but is not a subagent of ${agentConfig().username}`;
    }

    // Remote agent - send start request through hub
    return await _startRemoteAgent(user, taskDescription);
  }

  async function _startRemoteAgent(
    user: {
      id: string;
      username: string;
      host_id: string | null;
      host: { name: string } | null;
    },
    taskDescription: string,
  ): Promise<string> {
    if (!user.host_id) {
      throw `Agent '${user.username}' has no host assigned`;
    }

    return await remoteAgentRequester.startAgent(
      user.id,
      user.host_id,
      userId,
      taskDescription,
      user.username,
      user.host?.name || null,
    );
  }

  /**
   * Don't want to confuse the AI with spawn vs start
   * Not sure if there's a good use case for spawning separate processes anymore
   */
  /*async function _spawnAgent(agentName: string, taskDescription: string) {
    const subagent = validateAgentStart(agentName, taskDescription);

    // Start subagent
    const installPath = pathService.getInstallPath();
    const naisysJsPath = path.join(installPath.getHostPath(), "dist/naisys.js");

    subagent.process = spawn(
      "node",
      [naisysJsPath, subagent.agentPath.toHostPath()],
      {
        stdio: "pipe",
        env: getCleanEnv(),
      },
    );

    // This handles if the host process dies, we want to kill child subagent processes too so they don't become orphans still running on the sysetm
    process.on("exit", () => {
      try {
        // Negative PID kills the entire process group
        if (subagent.process?.pid) {
          process.kill(-subagent.process.pid);
        }
      } catch (e) {
        // Process might already be dead
      }
    });

    // Run async so that the process spawn handler is setup immediately otherwise it'll be missed
    void sendStartupMessage(subagent, taskDescription);

    // Wait 5 seconds for startup errors, then return success
    const startupPromise = new Promise<string>((resolve) => {
      let hasSpawned = false;

      const timeout = setTimeout(() => {
        if (hasSpawned && subagent.status === "spawned") {
          let response = `Subagent '${agentName}' Started (ID: ${subagent.id})`;
          if (agentConfig().mailEnabled) {
            response += `\nUse ns-mail to communicate with the subagent '${subagent.agentName}'`;
          }
          resolve(response);
        } else {
          resolve(`Subagent '${agentName}' failed to start properly`);
        }
      }, 5000);

      subagent.process!.on("spawn", () => {
        hasSpawned = true;
        subagent.status = "spawned";
        subagent.id = subagent.process?.pid || -1;
        subagent.log.push(`SUBAGENT ${agentName} SPAWNED\n`);
      });

      subagent.process!.on("error", (error) => {
        clearTimeout(timeout);
        resolve(`Failed to start subagent '${agentName}': ${error}`);
      });

      subagent.process!.on("close", (code) => {
        if (!hasSpawned || code !== 0) {
          clearTimeout(timeout);
          resolve(`Subagent '${agentName}' exited early with code ${code}`);
        }
      });
    });

    subagent.process.stdout!.on("data", (data) => {
      const dataLines = <string[]>data.toString().split("\n");
      dataLines.forEach((line) => subagent.log.push(line));
    });

    subagent.process.stderr!.on("data", (data) => {
      subagent.log.push(`\nSUBAGENT ${agentName} ERROR: ${data}`);
    });

    subagent.process.on("close", (code) => {
      subagent.log.push(
        `\nSUBAGENT ${subagent.agentName} TERMINATED with code ${code}\n`,
      );
      handleAgentTermination(
        subagent,
        code === 0 ? "terminated" : `exited with code ${code}`,
      );
    });

    return await startupPromise;
  }*/

  async function sendStartupMessage(
    subagent: Subagent,
    taskDescription: string,
  ) {
    if (!agentConfig().mailEnabled) {
      return;
    }

    return await llmail
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

    // Also check if running in agentManager (debug user can stop agents other than local subagents)
    const agentRuntime = agentManager.runningAgents.find(
      (a) => a.agentUsername === agentName,
    );

    if (!subagent && !agentRuntime) {
      throw `Agent '${agentName}' not found`;
    }

    if (subagent?.status === "stopped") {
      throw `Agent '${agentName}' is already stopped`;
    }

    // Process termination event will set status to stopped
    subagent?.process?.kill();

    if (agentRuntime) {
      // Request shutdown of in-process agent, callback defined in start() will handle termination event
      void agentManager.stopAgent(
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
    const agentRuntime = agentManager.runningAgents.find(
      (a) => a.agentUsername === agentName,
    );

    if (!agentRuntime) {
      throw `Agent '${agentName}' is not running`;
    }

    agentManager.setActiveConsoleAgent(agentRuntime.agentUserId);

    return "";
  }

  function handleAgentTermination(subagent: Subagent, reason: string) {
    _terminationEvents.push({
      userId: subagent.userId,
      agentName: subagent.agentName,
      reason,
    });

    subagent.status = "stopped";
    subagent.taskDescription = undefined;
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
    getTerminationEvents,
    cleanup,
    raiseSwitchEvent,
    switchEventTriggered,
  };
}

export type SubagentService = ReturnType<typeof createSubagentService>;
