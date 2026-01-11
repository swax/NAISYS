import { ChildProcess } from "child_process";
import path from "path";
import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agentConfig.js";
import { DatabaseService } from "../services/dbService.js";
import { HostService } from "../services/hostService.js";
import { NaisysPath } from "../services/pathService.js";
import { RunService } from "../services/runService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import { LLMail } from "./llmail.js";

interface Subagent {
  id?: number;
  agentName: string;
  agentPath: NaisysPath;
  title: string;
  taskDescription?: string;
  process?: ChildProcess;
  log: string[];
  status: "spawned" | "started" | "stopped";
}

/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
type IAgentManager = {
  startAgent: (
    agentPath: string,
    onStop?: (reason: string) => void,
  ) => Promise<number>;
  stopAgent: (
    agentRuntimeId: number,
    mode: "requestShutdown" | "completeShutdown",
    reason: string,
  ) => Promise<void>;
  runningAgents: Array<{
    agentRunId: number;
    agentUsername: string;
    agentTitle: string;
    agentTaskDescription?: string;
  }>;
  getBufferLines: (agentRuntimeId: number) => number;
  setActiveConsoleAgent: (agentRuntimeId: number) => void;
};

export function createSubagentService(
  { agentConfig }: AgentConfig,
  llmail: LLMail,
  output: OutputService,
  agentManager: IAgentManager,
  inputMode: InputModeService,
  runService: RunService,
  { usingDatabase }: DatabaseService,
  { localHostId }: HostService,
) {
  const _subagents: Subagent[] = [];

  // Track running subagents and termination events
  const _terminationEvents: Array<{
    id: number;
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
  stop <id>: Stops the agent with the given task id
  start <username> "<description>": Starts an existing agent with the given name and description of the task to perform`;

        //  create "<agent title>" "<description>": Creates a new agent. Include as much detail in the description as possible.
        //  spawn <username> <description>: Spawns the agent as a separate isolated node process (generally use start instead)

        if (inputMode.isDebug()) {
          helpOutput += `\n  switch <id>: Switch context to a started in-process agent (debug mode only)`;
          helpOutput += `\n  flush <id>: Flush a spawned agent's output (debug mode only)`;
        }

        helpOutput += `\n\n* You can have up to ${agentConfig().subagentMax} subagents running at a time.`;

        if (agentConfig().mailEnabled) {
          helpOutput += ` Use llmail to communicate with subagents by name.`;
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
          errorText = "Missing required parameters. Expected: start <username> \"<description>\"\n";
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

        const subagentId = parseInt(argv[1]);
        return _switchAgent(subagentId);
      }
      case "stop": {
        const subagentId = parseInt(argv[1]);
        return _stopAgent(subagentId, "subagent stop");
      }
      case "flush": {
        const subagentId = parseInt(argv[1]);
        _debugFlushContext(subagentId);
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
          lead_username: agentConfig().username,
          host_id: localHostId,
        },
      });

      agents.forEach((agent) => {
        const existing = _subagents.find((p) => p.agentName === agent.username);
        if (!existing) {
          _subagents.push({
            agentName: agent.username,
            agentPath: new NaisysPath(agent.agent_path),
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

    const subagentRows = _subagents.map((p) => [
      p.agentName,
      p.id || "",
      p.status,
      p.taskDescription?.substring(0, 70) || p.title,
      inputMode.isDebug() && p.id
        ? (p.log.length || agentManager.getBufferLines(p.id)).toString()
        : "",
    ]);

    if (subagentRows.length === 0) {
      agentList += "No subagents found.";
    } else {
      agentList += table(
        [
          [
            "Name",
            "ID",
            "Status",
            "Task",
            inputMode.isDebug() ? "Unread Lines" : "",
          ],
          ...subagentRows,
        ],
        { hsep: " | " },
      );
    }

    if (inputMode.isDebug()) {
      // Find running in process agents that aren't already listed
      const myRunId = runService.getRunId();

      const otherAgents = agentManager.runningAgents
        .filter(
          (ra) =>
            ra.agentRunId != myRunId &&
            !_subagents.find((sa) => sa.id === ra.agentRunId),
        )
        .map((ra) => {
          return {
            agentName: ra.agentUsername,
            id: ra.agentRunId,
            status: "started",
            title: ra.agentTitle,
            taskDescription: ra.agentTaskDescription,
            unreadLines: agentManager.getBufferLines(ra.agentRunId),
          };
        });

      if (otherAgents.length > 0) {
        agentList += "\n\nOther In-Process Running Agents:\n";

        agentList += table(
          [
            ["Name", "ID", "Status", "Task", "Unread Lines"],
            ...otherAgents.map((p) => [
              p.agentName,
              p.id || "",
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
  ): Array<{ id: number; agentName: string; reason: string }> {
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
      subagentConfig.initialCommands = ["llmail users", "llmail help"];
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

  function validateAgentStart(agentName: string, taskDescription: string) {
    if (!agentName) {
      throw "Subagent name is required to start a subagent";
    }

    if (!taskDescription) {
      throw "Task description is required to start a subagent";
    }

    const subagent = _subagents.find((p) => p.agentName === agentName);
    if (!subagent) {
      throw `Subagent '${agentName}' not found`;
    }

    if (subagent.status !== "stopped") {
      throw `Subagent '${agentName}' is already running`;
    }

    // Check that max sub agents aren't already started
    const runningSubagents = _subagents.filter((p) => p.status !== "stopped");
    if (runningSubagents.length >= (agentConfig().subagentMax || 1)) {
      throw `Max subagents already running`;
    }

    return subagent;
  }

  async function _startAgent(agentName: string, taskDescription: string) {
    const subagent = validateAgentStart(agentName, taskDescription);

    subagent.id = await agentManager.startAgent(
      subagent.agentPath.toHostPath(),
      (stopReason) => handleAgentTermination(subagent, stopReason),
    );

    subagent.taskDescription = taskDescription;
    subagent.status = "started";

    await sendStartupMessage(subagent, taskDescription);

    // subagent switch command, only visible to debug mode, finds and sets the active subagent through the subagent mangager (this service, no higher level injected service)

    return `Subagent '${agentName}' Started (ID: ${subagent.id})`;
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
            response += `\nUse llmail to communicate with the subagent '${subagent.agentName}'`;
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
      .newThread([subagent.agentName], "Your Task", taskDescription)
      .catch(async () => {
        await output.commentAndLog(
          `Failed to send initial task email to subagent ${subagent.agentName}`,
        );
      });
  }

  function _stopAgent(id: number, reason: string) {
    // Get if the agent is running in process, debug user can stop agents other than the local subagent ones
    const agentRuntime = agentManager.runningAgents.find(
      (a) => a.agentRunId === id,
    );

    // The local record of the subagent
    const subagent = _subagents.find((p) => p.id === id);

    if (!subagent && !agentRuntime) {
      throw `Subagent ${id} not found`;
    }

    if (subagent?.status === "stopped") {
      throw `Subagent ${id} is already stopped`;
    }

    // Process termination event will set status to stopped
    subagent?.process?.kill();

    if (agentRuntime) {
      // Request shutdown of in-process agent, callback defined in start() will handle termination event
      void agentManager.stopAgent(id, "requestShutdown", reason);
    }

    if (subagent) {
      return `Subagent ${subagent.agentName} stop requested`;
    } else if (agentRuntime) {
      return `Agent ${agentRuntime.agentUsername} stop requested`;
    } else {
      throw `Subagent ${id} not found`;
    }
  }

  /** Stop all agents with ids */
  function cleanup(reason: string) {
    _subagents.forEach((subagent) => {
      if (subagent.id) {
        try {
          _stopAgent(subagent.id, reason);
        } catch {}
      }
    });
  }

  /** Only for in-process agents */
  function _switchAgent(id: number) {
    agentManager.setActiveConsoleAgent(id);

    return "";
  }

  function handleAgentTermination(subagent: Subagent, reason: string) {
    _terminationEvents.push({
      id: subagent.id || -1,
      agentName: subagent.agentName,
      reason,
    });

    subagent.status = "stopped";
    subagent.taskDescription = undefined;
    subagent.id = undefined;
  }

  /** Only used in debug mode, not by LLM */
  function _debugFlushContext(subagentId: number) {
    const subagent = _subagents.find((p) => p.id === subagentId);
    if (!subagent) {
      throw `Subagent ${subagentId} not found`;
    }

    if (subagent.status == "started") {
      throw `Subagent ${subagentId} is not a spawned subagent, use the switch command to see output.`;
    }

    subagent.log.forEach((line) => output.write(line, OutputColor.subagent));

    subagent.log.length = 0;
  }

  function _getSubagentDir() {
    const agentDirectory = path.dirname(agentConfig().hostpath);

    return new NaisysPath(
      `${agentDirectory}/${agentConfig().subagentDirectory}`,
    );
  }

  return {
    handleCommand,
    getRunningSubagentNames,
    getTerminationEvents,
    cleanup,
    raiseSwitchEvent,
    switchEventTriggered,
  };
}

export type SubagentService = ReturnType<typeof createSubagentService>;
