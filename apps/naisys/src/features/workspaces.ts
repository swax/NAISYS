import * as fs from "fs";
import path from "path";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import * as pathService from "../services/pathService.js";
import { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createWorkspacesFeature(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  output: OutputService,
) {
  const _suffixHelp =
    "Add and remove file soft links in the ~/workspaces/ folder to manage what files you see previews of before each prompt";

  function getLatestContent() {
    if (!globalConfig().workspacesEnabled) {
      return "";
    }

    const workspacesDir = _getWorkspacesDir();

    pathService.ensureDirExists(workspacesDir);

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

  function displayActive() {
    if (!globalConfig().workspacesEnabled) {
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
    return path.join(
      globalConfig().naisysFolder,
      "home",
      agentConfig().username,
      "workspaces",
    );
  }

  return {
    getLatestContent,
    displayActive,
  };
}

export type WorkspacesFeature = ReturnType<typeof createWorkspacesFeature>;
