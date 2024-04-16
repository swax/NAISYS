import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import yaml from "js-yaml";
import path from "path";
import table from "text-table";
import * as config from "../config.js";
import { AgentConfig } from "../config.js";
import { agentNames } from "../utils/agentNames.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import * as pathService from "../utils/pathService.js";
import { NaisysPath } from "../utils/pathService.js";
import { getTokenCount, shuffle } from "../utils/utilities.js";
import * as llmail from "./llmail.js";

interface Subagent {
  id: number;
  agentName: string;
  agentPath: NaisysPath;
  taskDescription: string;
  process?: ChildProcess;
  log: string;
  status: "running" | "stopped";
  tokensSpent: number;
}

let _nextAgentId = 1;
const _subagents: Subagent[] = [];

_init();

function _init() {
  // Load subagents for user from file system
  const subagentDir = _getSubagentDir();
  const subagentHostDir = subagentDir.toHostPath();

  if (!fs.existsSync(subagentHostDir)) {
    return;
  }

  const subagentFiles = fs.readdirSync(subagentHostDir);

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
      taskDescription: subagentConfig.taskDescription || "No task description",
      log: "",
      status: "stopped",
      tokensSpent: 0,
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
  create "<agent title>" "<agent task and guidance>": Creates a new agent. Treat it like a new hire. Include as much detail and guidace as possible.
  stop <id>: Stops the agent with the given task id
  start <id>: Starts a stopped agent with the given task id`;

      if (inputMode.current == InputMode.Debug) {
        helpOutput += `\n  flush <id>: Debug only command to show the agent's context log`;
      }

      helpOutput += `\n\n* You can have up to ${config.agent.subagentMax} subagents running at a time. Use llmail to communicate with subagents by name.`;

      return helpOutput;
    }
    case "list": {
      return table(
        [
          ["ID", "Status", "Name", "Task", "Tokens Spent"],
          ..._subagents.map((p) => [
            p.id,
            p.status,
            p.agentName,
            p.taskDescription.substring(0, 70),
            p.tokensSpent,
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
      return _startAgent(subagentId);
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

  if (unreadAgents.length === 0) {
    return "";
  }

  output.comment(
    "New Subagent Output: " +
      unreadAgents
        .map((p) => `${p.id}:${p.agentName}, ${getTokenCount(p.log)} tokens`)
        .join(" | "),
  );
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
  const agentYaml = yaml.dump({
    ...config.agent,
    username: agentName,
    title,
    agentPrompt:
      `You are \${agent.username} a \${agent.title} with the job of helping out the \${agent.leadAgent} with what they want to do.\n` +
      `Task Description: \${agent.taskDescription}\n` +
      `Perform the above task and/or wait for messages from \${agent.leadAgent} and respond to them.`,
    wakeOnMessage: true,
    initialCommands: ["llmail users", "llmail help"],
    leadAgent: config.agent.username,
    taskDescription,
  });

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
    tokensSpent: 0,
  });

  return "Subagent Created\n" + _startAgent(id);
}

function _startAgent(id: number) {
  const subagent = _subagents.find((p) => p.id === id);
  if (!subagent) {
    throw `Subagent ${id} not found`;
  }

  if (subagent.status === "running") {
    throw `Subagent ${id} is already running`;
  }

  // Check that max sub agents aren't already started
  const runningSubagents = _subagents.filter((p) => p.status === "running");
  if (runningSubagents.length >= (config.agent.subagentMax || 0)) {
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
    },
  );

  subagent.process.on("spawn", () => {
    subagent.status = "running";
    subagent.log += `SUBAGENT ${id} SPAWNED\n`;
  });

  subagent.process.stdout!.on("data", (data) => {
    const dataStr = data.toString();
    subagent.log += dataStr;
    subagent.tokensSpent += getTokenCount(dataStr);
  });

  subagent.process.stderr!.on("data", (data) => {
    output.error(`SUBAGENT ${id} ERROR: ${data}`);
  });

  subagent.process.on("close", () => {
    subagent.log += `\nSUBAGENT ${id} CLOSED`;
    subagent.status = "stopped";
  });

  return `Subagent ID: ${id} Started\nUse llmail to communicate with the subagent '${subagent.agentName}'`;
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
  return new NaisysPath(
    `${config.naisysFolder}/agent-data/${config.agent.username}/subagents`,
  );
}
