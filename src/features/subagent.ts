import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import yaml from "js-yaml";
import path from "path";
import table from "text-table";
import * as config from "../config.js";
import { AgentConfig } from "../config.js";
import * as pathService from "../services/pathService.js";
import { NaisysPath } from "../services/pathService.js";
import { agentNames } from "../utils/agentNames.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import { getCleanEnv, getTokenCount, shuffle } from "../utils/utilities.js";
import * as llmail from "./llmail.js";

interface Subagent {
  id: number;
  agentName: string;
  agentPath: NaisysPath;
  taskDescription: string;
  process?: ChildProcess;
  log: string;
  status: "running" | "stopped";
}

let _nextAgentId = 1;
const _subagents: Subagent[] = [];

// Track running subagents and termination events
const _runningSubagentIds = new Set<number>();
const _terminationEvents: Array<{
  id: number;
  agentName: string;
  reason: string;
}> = [];

_init();

function _init() {
  if (!config.agent.subagentDirectory) {
    return;
  }

  // Load subagents for user from file system
  const subagentDir = _getSubagentDir();
  const subagentHostDir = subagentDir.toHostPath();

  if (!fs.existsSync(subagentHostDir)) {
    return;
  }

  const subagentFiles = fs.readdirSync(subagentHostDir).filter(file => {
    const filePath = path.join(subagentHostDir, file);
    return fs.statSync(filePath).isFile();
  });

  // Iterate files
  for (const subagentFile of subagentFiles) {
    const agentHostPath = path.join(subagentHostDir, subagentFile);
    const subagentYaml = fs.readFileSync(agentHostPath, "utf8");
    const subagentConfig = yaml.load(subagentYaml) as AgentConfig;

    // Add to subagents
    _subagents.push({
      id: _nextAgentId++,
      agentName: subagentConfig.username,
      agentPath: new NaisysPath(agentHostPath),
      taskDescription: subagentConfig.taskDescription || subagentConfig.title || "No task description",
      log: "",
      status: "stopped",
    });
  }
}

export async function handleCommand(args: string): Promise<string> {
  const argParams = args.split(" ");

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  let errorText = "";

  switch (argParams[0]) {
    case "help": {
      let helpOutput = `subagent <command>
  list: Lists all subagents
  create "<agent title>" "<description>": Creates a new agent. Include as much detail in the description as possible.
  stop <id>: Stops the agent with the given task id
  start <id> <description>: Starts an existing agent with the given task id and description of the task to perform`;

      if (inputMode.current == InputMode.Debug) {
        helpOutput += `\n  flush <id>: Debug only command to show the agent's context log`;
      }

      helpOutput += `\n\n* You can have up to ${config.agent.subagentMax} subagents running at a time.`;

      if (config.agent.mailEnabled) {
        helpOutput += ` Use llmail to communicate with subagents by name.`;
      }

      return helpOutput;
    }
    case "list": {
      return table(
        [
          ["ID", "Status", "Name", "Task"],
          ..._subagents.map((p) => [
            p.id,
            p.status,
            p.agentName,
            p.taskDescription.substring(0, 70),
          ]),
        ],
        { hsep: " | " },
      );
    }
    case "create": {
      const newParams = argParams.slice(1).join(" ").split('"');
      const title = newParams[1];
      const task = newParams[3];

      // Validate title and task set
      if (!title || !task) {
        errorText = "See valid 'create' syntax below:\n";
        break;
      }

      return await _createAgent(title, task);
    }
    case "start": {
      const subagentId = parseInt(argParams[1]);
      const taskDescription = args.split('"')[1];

      return await _startAgent(subagentId, taskDescription);
    }
    case "stop": {
      const subagentId = parseInt(argParams[1]);
      return _stopAgent(subagentId);
    }
    case "flush": {
      const subagentId = parseInt(argParams[1]);
      _debugFlushContext(subagentId);
      return "";
    }
    default: {
      errorText = "Error, unknown command. See valid commands below:\n";
    }
  }

  return errorText + (await handleCommand("help"));
}

export function getRunningSubagentNames() {
  return _subagents
    .filter((p) => p.status === "running")
    .map((p) => p.agentName);
}

/** Return list of subagents with unread context */
export function unreadContextSummary() {
  const unreadAgents = _subagents.filter((p) => p.log.length > 0);

  let summaryParts = [];

  if (unreadAgents.length > 0) {
    summaryParts.push(
      "New Subagent Output: " +
        unreadAgents
          .map((p) => `${p.id}:${p.agentName}, ${getTokenCount(p.log)} tokens`)
          .join(" | "),
    );
  }

  if (summaryParts.length > 0) {
    output.comment(summaryParts.join(" | "));
  }
}

/** Check for and clear termination events for wake notifications */
export function getTerminationEvents(
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

async function _createAgent(title: string, taskDescription: string) {
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
  const subagentConfig: AgentConfig = {
    ...config.agent,
    username: agentName,
    title,
    agentPrompt:
      `You are \${agent.username} a \${agent.title} with the job of helping out the \${agent.leadAgent} with what they want to do.\n` +
      `Task Description: \${agent.taskDescription}\n` +
      `Perform the above task and/or wait for messages from \${agent.leadAgent} and respond to them.` +
      `When completed use the 'completeTask' command to signal that you are done.`,
    wakeOnMessage: true,
    completeTaskEnabled: true,
    leadAgent: config.agent.username,
    mailEnabled: true, // Needed to communicate the task completion message
    taskDescription,
  };

  if (config.mailEnabled) {
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

  const id = _nextAgentId++;

  _subagents.push({
    id,
    agentName,
    agentPath,
    taskDescription,
    log: "",
    status: "stopped",
  });

  return "Subagent Created\n" + (await _startAgent(id, taskDescription));
}

async function _startAgent(id: number, taskDescription: string) {
  if (!taskDescription) {
    throw "Task description is required to start a subagent";
  }

  const subagent = _subagents.find((p) => p.id === id);
  if (!subagent) {
    throw `Subagent ${id} not found`;
  }

  if (subagent.status === "running") {
    throw `Subagent ${id} is already running`;
  }

  // Check that max sub agents aren't already started
  const runningSubagents = _subagents.filter((p) => p.status === "running");
  if (runningSubagents.length >= (config.agent.subagentMax || 1)) {
    throw `Max subagents already running`;
  }

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

  // Run async so that the process spawn handler is setup immediately otherwise it'll be missed
  void llmail
    .newThread([subagent.agentName], "Your Task", taskDescription)
    .catch(() => {
      output.commentAndLog(
        `Failed to send initial task email to subagent ${subagent.agentName}`,
      );
    });

  // Wait 5 seconds for startup errors, then return success
  const startupPromise = new Promise<string>((resolve) => {
    let hasSpawned = false;

    const timeout = setTimeout(() => {
      if (hasSpawned && subagent.status === "running") {
        let response = `Subagent ID: ${id} Started`;
        if (config.mailEnabled) {
          response += `\nUse llmail to communicate with the subagent '${subagent.agentName}'`;
        }
        resolve(response);
      } else {
        resolve(`Subagent ${id} failed to start properly`);
      }
    }, 5000);

    subagent.process!.on("spawn", () => {
      hasSpawned = true;
      subagent.status = "running";
      subagent.log += `SUBAGENT ${id} SPAWNED\n`;
      _runningSubagentIds.add(id);
    });

    subagent.process!.on("error", (error) => {
      clearTimeout(timeout);
      resolve(`Failed to start subagent ${id}: ${error}`);
    });

    subagent.process!.on("close", (code) => {
      if (!hasSpawned || code !== 0) {
        clearTimeout(timeout);
        resolve(`Subagent ${id} exited early with code ${code}`);
      }
    });
  });

  subagent.process.stdout!.on("data", (data) => {
    const dataStr = data.toString();
    subagent.log += dataStr;
  });

  subagent.process.stderr!.on("data", (data) => {
    subagent.log += `\nSUBAGENT ${id} ERROR: ${data}`;
  });

  subagent.process.on("close", (code) => {
    subagent.log += `\nSUBAGENT ${id} CLOSED`;
    subagent.status = "stopped";

    // If this was still in the running list, it terminated unexpectedly
    if (_runningSubagentIds.has(id)) {
      _runningSubagentIds.delete(id);
      _terminationEvents.push({
        id,
        agentName: subagent.agentName,
        reason: code === 0 ? "completed" : `exited with code ${code}`,
      });
    }
  });

  return await startupPromise;
}

function _stopAgent(id: number) {
  const subagent = _subagents.find((p) => p.id === id);
  if (!subagent) {
    throw `Subagent ${id} not found`;
  }

  if (subagent.status === "stopped") {
    throw `Subagent ${id} is already stopped`;
  }

  subagent.process?.kill();

  // Remove from running list since this was a manual stop
  _runningSubagentIds.delete(id);

  return `Subagent ${id} stopped`;
}

/** Only used in debug mode, not by LLM */
function _debugFlushContext(subagentId: number) {
  const subagent = _subagents.find((p) => p.id === subagentId);
  if (!subagent) {
    throw `Subagent ${subagentId} not found`;
  }

  output.write(subagent.log, OutputColor.subagent);

  subagent.log = "";
}

function _getSubagentDir() {
  const agentDirectory = path.dirname(config.agent.hostpath);

  return new NaisysPath(`${agentDirectory}/${config.agent.subagentDirectory}`);
}
