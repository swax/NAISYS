import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import yaml from "js-yaml";
import table from "text-table";
import * as config from "../config.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import { ensureFileDirExists, getTokenCount } from "../utils/utilities.js";
import * as llmail from "./llmail.js";

interface ISubagent {
  id: number;
  agentName: string;
  taskDescription: string;
  process: ChildProcess;
  log: string;
  status: "running" | "stopped";
  tokensSpent: number;
}

let _nextAgentId = 1;
let _subagents: ISubagent[] = [];

export async function handleCommand(args: string): Promise<string> {
  // genimg sholdn't even be presented as an available command unless it is defined in the config
  if (!config.subagentsEnabled) {
    throw "Agent config: Error, 'imageModel' is not defined";
  }

  const argParams = args.split(" ");

  if (!argParams[0]) {
    argParams[0] = "help";
  }

  switch (argParams[0]) {
    case "help": {
      return `subagent <command>
  list: Lists all subagents
  start <task description>: Starts a new agent with the task given by the descirption. 
  stop <id>: Stops the agent with the given task id
  restart <id>: Starts a stopped agent with the given task id`;
    }
    case "list": {
      return table(
        [
          ["ID", "Status", "Name", "Task", "Tokens Spent"],
          ..._subagents.map((p) => [
            p.id,
            p.status,
            p.agentName,
            p.taskDescription,
          ]),
        ],
        { hsep: " | " },
      );
    }
    case "start": {
      const taskDescription = argParams.slice(1).join(" ");
      return await startAgent(taskDescription);
    }
    // Debug only command to show the agent's context log
    case "flush": {
      const subagentId = parseInt(argParams[1]);
      debugFlushContext(subagentId);
      return "";
    }
    default:
      return (
        "Error, unknown command. See valid commands below:\n" +
        (await handleCommand("help"))
      );
  }
}

async function startAgent(taskDescription: string) {
  const usernames = await llmail.getUserNames();
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
  const agentTitle = "Software Engineer";

  const agentYaml = yaml.dump({
    username: agentName,
    title: agentTitle,
    shellModel: config.agent.shellModel,
    dreamModel: config.agent.dreamModel,
    webModel: config.agent.webModel,
    agentPrompt:
      `You are ${agentName} a ${agentTitle} with the job of helping out the ${config.agent.username} with what she wants to do.` +
      `Task Description: ${taskDescription}` +
      `Perform the above ask and/or wait for messages from ${config.agent.username} and respond to them.`,
    tokenMax: config.agent.tokenMax,
    debugPauseSeconds: config.agent.debugPauseSeconds,
    wakeOnMessage: true,
    spendLimitDollars: config.agent.spendLimitDollars,
    initialCommands: ["llmail users", "llmail help"],
  });

  // write agent yaml to file
  const agentPath = `${config.naisysFolder}/home/${agentName}/.subagents/${agentName}.yaml`;
  ensureFileDirExists(agentPath);
  fs.writeFileSync(agentPath, agentYaml);

  // TODO fix dist path for npm
  const process = spawn("node", ["dist/naisys.js", agentPath], {
    stdio: "pipe",
  });

  const id = _nextAgentId++;

  const subagent: ISubagent = {
    id,
    agentName,
    taskDescription,
    process,
    log: `SUB-AGENT ${id} OPENED\n`,
    status: "running",
    tokensSpent: 0,
  };

  process.stdout.on("data", (data) => {
    const dataStr = data.toString();
    subagent.log += dataStr;
    subagent.tokensSpent += getTokenCount(dataStr);
  });

  process.stderr.on("data", (data) => {
    output.error(`SUB-AGENT ${id} ERROR: ${data}`);
  });

  process.on("close", () => {
    subagent.log += `\nSUB-AGENT ${id} CLOSED`;
  });

  _subagents.push(subagent);

  return `Sub-agent ${id} started`;
}

/** Only used in debug mode, not by LLM */
function debugFlushContext(subagentId: number) {
  const subagent = _subagents.find((p) => p.id === subagentId);
  if (!subagent) {
    throw `Sub-agent ${subagentId} not found`;
  }

  output.write(subagent.log, OutputColor.subagent);

  subagent.log = "";
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
