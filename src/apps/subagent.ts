import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import yaml from "js-yaml";
import table from "text-table";
import * as config from "../config.js";
import { AgentConfig } from "../config.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import {
  ensureFileDirExists,
  getTokenCount,
  unixToHostPath,
} from "../utils/utilities.js";
import * as llmail from "./llmail.js";

interface Subagent {
  id: number;
  agentName: string;
  agentPath: string;
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
  const subagentDir = unixToHostPath(_getSubagentDir());

  if (!fs.existsSync(subagentDir)) {
    return;
  }

  const subagentFiles = fs.readdirSync(subagentDir);

  // Iterate files
  for (const subagentFile of subagentFiles) {
    const agentPath = `${subagentDir}/${subagentFile}`;
    const subagentYaml = fs.readFileSync(agentPath, "utf8");
    const subagentConfig = yaml.load(subagentYaml) as AgentConfig;

    // Add to subagents
    _subagents.push({
      id: _nextAgentId++,
      agentName: subagentConfig.username,
      agentPath,
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

      helpOutput += `\n\n* You can have up to ${config.agent.subagentMax} subagents running at a time. Use llmail to communicate with subagents.`;

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
    default:
      return (
        "Error, unknown command. See valid commands below:\n" +
        (await handleCommand("help"))
      );
  }
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
  // Validate title and task set
  if (!title || !taskDescription) {
    throw "Title and task description must be set";
  }

  // Get available username
  const usernames = await llmail.getAllUserNames();
  let agentName = "";

  for (const name of _agentNames) {
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
    username: agentName,
    title,
    shellModel: config.agent.shellModel,
    dreamModel: config.agent.dreamModel,
    webModel: config.agent.webModel,
    agentPrompt:
      `You are \${agent.username} a \${agent.title} with the job of helping out the \${agent.leadAgent} with what they want to do.\n` +
      `Task Description: \${agent.taskDescription}\n` +
      `Perform the above task and/or wait for messages from \${agent.leadAgent} and respond to them.`,
    tokenMax: config.agent.tokenMax,
    debugPauseSeconds: config.agent.debugPauseSeconds,
    wakeOnMessage: true,
    spendLimitDollars: config.agent.spendLimitDollars,
    initialCommands: ["llmail users", "llmail help"],
    leadAgent: config.agent.username,
    taskDescription,
  });

  // write agent yaml to file
  const subagentDir = _getSubagentDir();
  const agentPath = unixToHostPath(`${subagentDir}/${agentName}.yaml`);
  ensureFileDirExists(agentPath);
  fs.writeFileSync(agentPath, agentYaml);

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

  return _startAgent(id);
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

  // TODO fix dist path for npm
  subagent.process = spawn("node", ["dist/naisys.js", subagent.agentPath], {
    stdio: "pipe",
  });

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

  return `Subagent ${id} started`;
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
  return `${config.naisysFolder}/home/${config.agent.username}/.subagents`;
}

const _agentNames = [
  "adrian",
  "alex",
  "allen",
  "andrew",
  "austin",
  "bill",
  "bob",
  "brian",
  "alice",
  "charlie",
  "christian",
  "daniel",
  "dave",
  "dylan",
  "edward",
  "eric",
  "eve",
  "frank",
  "gina",
  "greg",
  "harry",
  "irene",
  "james",
  "jason",
  "jeff",
  "jenny",
  "joe",
  "john",
  "joyce",
  "julie",
  "kate",
  "kenny",
  "kenzo",
  "larry",
  "marge",
  "mike",
  "nate",
  "olivia",
  "paul",
  "quinn",
  "rose",
  "russell",
  "sam",
  "scott",
  "shaddy",
  "simon",
  "ted",
  "tina",
  "tj",
  "ulysses",
  "victor",
  "wendy",
  "xander",
  "yaron",
  "yvonne",
  "zack",
];
