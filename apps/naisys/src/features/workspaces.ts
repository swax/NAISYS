import * as fs from "fs";
import path from "path";
import stringArgv from "string-argv";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import * as utilities from "../utils/utilities.js";

export function createWorkspacesFeature(shellWrapper: ShellWrapper) {
  // In-memory storage of tracked file paths (absolute paths)
  const _trackedFiles = new Set<string>();

  async function handleCommand(args: string): Promise<string> {
    const argv = stringArgv(args);
    const subCommand = argv[0]?.toLowerCase();
    const filePath = argv[1];

    switch (subCommand) {
      case "add":
        return await _addFile(filePath);
      case "remove":
        return await _removeFile(filePath);
      case "list":
        return listFiles();
      case "clear":
        return _clearFiles();
      default:
        return `Usage: ns-workspace <add|remove|list|clear> [filepath]
  add <filepath>    - Add a file to the workspace (contents shown in context)
  remove <filepath> - Remove a file from the workspace
  list              - List all tracked files
  clear             - Remove all files from the workspace`;
    }
  }

  async function _addFile(filePath: string): Promise<string> {
    if (!filePath) {
      return "Error: filepath is required for add command";
    }

    const absolutePath = await _resolveToAbsolutePath(filePath);

    if (!fs.existsSync(absolutePath)) {
      return `Error: File not found: ${absolutePath}`;
    }

    if (!fs.statSync(absolutePath).isFile()) {
      return `Error: Path is not a file: ${absolutePath}`;
    }

    if (_trackedFiles.has(absolutePath)) {
      return `File already in workspace: ${absolutePath}`;
    }

    _trackedFiles.add(absolutePath);
    return `Added to workspace: ${absolutePath}`;
  }

  async function _removeFile(filePath: string): Promise<string> {
    if (!filePath) {
      return "Error: filepath is required for remove command";
    }

    const absolutePath = await _resolveToAbsolutePath(filePath);

    if (!_trackedFiles.has(absolutePath)) {
      return `File not in workspace: ${absolutePath}`;
    }

    _trackedFiles.delete(absolutePath);
    return `Removed from workspace: ${absolutePath}`;
  }

  function listFiles(): string {
    if (_trackedFiles.size === 0) {
      return "Workspace is empty";
    }

    const files = Array.from(_trackedFiles);
    return `Workspace files:\n${files.map((f) => `  ${f}`).join("\n")}`;
  }

  function _clearFiles(): string {
    const count = _trackedFiles.size;
    _trackedFiles.clear();
    return `Cleared ${count} file(s) from workspace`;
  }

  async function _resolveToAbsolutePath(filePath: string): Promise<string> {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }

    const cwd = await shellWrapper.getCurrentPath();
    if (!cwd) {
      throw new Error("Unable to get current working directory");
    }

    return path.normalize(path.join(cwd, filePath));
  }

  function getContext(): string {
    if (_trackedFiles.size === 0) {
      return "";
    }

    let response = `Current Workspaces:`;

    for (const filePath of _trackedFiles) {
      if (!fs.existsSync(filePath)) {
        response += `\n${filePath}: [FILE NOT FOUND]`;
        continue;
      }

      const fileContents = fs.readFileSync(filePath, "utf8");
      response += `\n${filePath} (${utilities.getTokenCount(fileContents)} tokens):`;
      response += `\n${fileContents}`;
      response += `\nEOF\n`;
    }

    return response;
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-workspace",
    helpText: "Manage files in the workspace for context inclusion",
    handleCommand,
  };

  return {
    ...registrableCommand,
    hasFiles: () => _trackedFiles.size > 0,
    listFiles,
    getContext,
  };
}

export type WorkspacesFeature = ReturnType<typeof createWorkspacesFeature>;
