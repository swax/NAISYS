/**
 * Platform abstraction layer for shell operations
 * Encapsulates platform-specific shell behavior for Windows (PowerShell) and Linux (bash)
 */

import { execSync } from "child_process";
import * as os from "os";

export type ShellPlatform = "windows" | "linux";

export interface PlatformConfig {
  platform: ShellPlatform;
  /** Shell command to spawn */
  shellCommand: string;
  /** Shell arguments */
  shellArgs: string[];
  /** Command delimiter echo syntax */
  echoDelimiter: (delimiter: string) => string;
  /** Get current working directory command */
  pwdCommand: string;
  /** Create directory command (with recursive support) */
  mkdirCommand: (path: string) => string;
  /** Change directory command */
  cdCommand: (path: string) => string;
  /** Script file extension */
  scriptExtension: string;
  /** Script shebang/header */
  scriptHeader: string;
  /** Set error handling (exit on first error) */
  scriptSetError: string;
  /** Path environment separator */
  pathSeparator: string;
  /** Dot-source/source a script so variable/cwd changes persist */
  sourceScript: (scriptPath: string) => string;
  /** One-liner that installs a shell-level handler intercepting any `ns-*`
   *  command that leaks into the shell (e.g. `echo foo && ns-mail ...`) and
   *  reminds the LLM that NAISYS commands must run on their own line.
   *  Injected once per shell session; pattern-based so new commands need no sync. */
  nsCommandNotFoundHandler: string;
  /** Platform name for display in MOTD */
  displayName: string;
  /** Shell name for display */
  shellName: string;
  /** Command not found error suffix */
  commandNotFoundSuffix: string;
  /** Error message for invalid commands */
  invalidCommandMessage: string;
  /** Prompt suffix for normal user (> on Windows, $ on Linux) */
  promptSuffix: string;
  /** Divider between user@host and current path in prompt */
  promptDivider: string;
  /** Prompt suffix for admin/root user */
  adminPromptSuffix: string;
}

const nsCommandHandlerMessage =
  "is a NAISYS command and must be run on its own line, not combined with shell commands. Run 'ns-help' to see available NAISYS commands.";

function getWindowsConfig(): PlatformConfig {
  return {
    platform: "windows",
    shellCommand: "powershell.exe",
    shellArgs: [
      "-NoProfile",
      "-NoLogo",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
    ],
    echoDelimiter: (delimiter: string) => `Write-Host "${delimiter}"`,
    pwdCommand: "(Get-Location).Path",
    mkdirCommand: (path: string) =>
      `New-Item -ItemType Directory -Force -Path "${path}" | Out-Null`,
    cdCommand: (path: string) => `Set-Location "${path}"`,
    scriptExtension: ".ps1",
    scriptHeader: "# PowerShell script",
    scriptSetError: "$ErrorActionPreference = 'Stop'",
    pathSeparator: ";",
    sourceScript: (scriptPath: string) => `. "${scriptPath}"`,
    nsCommandNotFoundHandler: `$ExecutionContext.InvokeCommand.CommandNotFoundAction = { param($n, $e) if ($n -like 'ns-*') { Write-Host "NAISYS: '$n' ${nsCommandHandlerMessage}"; $e.CommandScriptBlock = { }; $e.StopSearch = $true } }`,
    displayName: "WINDOWS",
    shellName: "PowerShell",
    commandNotFoundSuffix: "is not recognized",
    invalidCommandMessage:
      "Please enter a valid PowerShell or NAISYS command after the prompt. Use the 'ns-comment' command for thoughts.",
    promptSuffix: ">",
    promptDivider: " ",
    adminPromptSuffix: "#",
  };
}

function getLinuxConfig(): PlatformConfig {
  return {
    platform: "linux",
    shellCommand: "bash",
    shellArgs: [],
    echoDelimiter: (delimiter: string) => `echo "${delimiter}"`,
    pwdCommand: "pwd",
    mkdirCommand: (path: string) => `mkdir -p "${path}"`,
    cdCommand: (path: string) => `cd "${path}"`,
    scriptExtension: ".sh",
    scriptHeader: "#!/bin/bash",
    scriptSetError: "set -e",
    pathSeparator: ":",
    sourceScript: (scriptPath: string) => `source "${scriptPath}"`,
    nsCommandNotFoundHandler: `command_not_found_handle() { case "$1" in ns-*) echo "NAISYS: '$1' ${nsCommandHandlerMessage}" >&2; return 127 ;; *) echo "bash: $1: command not found" >&2; return 127 ;; esac; }`,
    displayName: "LINUX",
    shellName: "bash",
    commandNotFoundSuffix: "command not found",
    invalidCommandMessage:
      "Please enter a valid Linux or NAISYS command after the prompt. Use the 'ns-comment' command for thoughts.",
    promptSuffix: "$",
    promptDivider: ":",
    adminPromptSuffix: "#",
  };
}

/** Determine if we should use native Windows mode */
export function useNativeWindows(): boolean {
  // On Windows, use native PowerShell instead of WSL
  return os.platform() === "win32";
}

/** Get the platform configuration for the current OS */
export function getPlatformConfig(): PlatformConfig {
  if (useNativeWindows()) {
    return getWindowsConfig();
  }
  return getLinuxConfig();
}

/** Get a specific platform configuration */
export function getPlatformConfigFor(platform: ShellPlatform): PlatformConfig {
  if (platform === "windows") {
    return getWindowsConfig();
  }
  return getLinuxConfig();
}

/** Cached result of elevation check (doesn't change during process lifetime) */
let elevatedCache: boolean | undefined;

/** Check if the process is running as root (Linux) or admin (Windows) */
export function isElevated(): boolean {
  if (elevatedCache !== undefined) {
    return elevatedCache;
  }

  if (os.platform() === "win32") {
    try {
      execSync("net session", { stdio: "ignore" });
      elevatedCache = true;
    } catch {
      elevatedCache = false;
    }
  } else {
    elevatedCache = process.getuid?.() === 0;
  }

  return elevatedCache;
}
