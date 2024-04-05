import * as fs from "fs";
import path from "path";
import * as config from "../config.js";
import * as output from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { ensureDirExists, unixToHostPath } from "../utils/utilities.js";

const _suffixHelp =
  "Add and remove file soft links in the ~/workspaces/ folder to manage what files you see previews of before each prompt";

export function getLatestContent() {
  if (!config.workspacesEnabled) {
    return "";
  }

  const workspacesDir = _getWorkspacesDir();

  ensureDirExists(workspacesDir);

  let response = `Current Workspaces:`;

  const files = fs.readdirSync(workspacesDir);

  if (!files.length) {
    response += `\n  None\n${_suffixHelp}`;
    return response;
  }

  // Iterate files in workspacesDir
  for (const file of files) {
    const filePath = path.join(workspacesDir, file);
    const fileContents = fs.readFileSync(filePath, "utf8");

    // get the path of what this file is soft linked to
    const realPath = fs.realpathSync(filePath);

    response += `\n${realPath} (${utilities.getTokenCount(fileContents)} tokens):`;
    response += `\n${fileContents}`;
    response += `\nEOF\n`;
  }

  return `${response}\n${_suffixHelp}`;
}

export function displayActive() {
  if (!config.workspacesEnabled) {
    return;
  }

  const workspacesDir = _getWorkspacesDir();

  const files = fs.readdirSync(workspacesDir);

  if (!files.length) {
    return;
  }

  // Show summary comment because the full file contents won't show in the console output, just in the llm's context
  output.comment("Active Workspaces: " + files.join(", "));
}

function _getWorkspacesDir() {
  return unixToHostPath(
    `${config.naisysFolder}/home/${config.agent.username}/workspaces/`,
  );
}
