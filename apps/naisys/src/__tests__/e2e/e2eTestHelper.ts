import { spawn, ChildProcess } from "child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface NaisysTestProcess {
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  sendCommand: (command: string) => void;
  sendNewLine: () => void;
  waitForOutput: (text: string, timeoutMs?: number) => Promise<void>;
  waitForOutputCount: (text: string, count: number, timeoutMs?: number) => Promise<void>;
  waitForPrompt: (promptCount?: number, timeoutMs?: number) => Promise<void>;
  getFullOutput: () => string;
  cleanup: () => Promise<void>;
}

export interface AgentYamlConfig {
  username: string;
  title: string;
  shellModel?: string;
  agentPrompt?: string;
  tokenMax?: number;
  debugPauseSeconds?: number;
  spendLimitDollars?: number;
  webEnabled?: boolean;
  mailEnabled?: boolean;
  wakeOnMessage?: boolean;
  subagentMax?: number;
}

/**
 * Get the path to a test directory under the system temp folder
 */
export function getTestDir(testName: string): string {
  return join(tmpdir(), "naisys_test", testName);
}

/**
 * Ensure test directory exists and is clean
 */
export function setupTestDir(testDir: string): void {
  // Clean up if exists
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }

  // Create fresh directory
  mkdirSync(testDir, { recursive: true });
}

/**
 * Clean up test directory
 */
export function cleanupTestDir(testDir: string): void {
  if (existsSync(testDir)) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  }
}

/**
 * Create a .env file for testing
 */
export function createEnvFile(testDir: string, options?: { naisysFolder?: string; hostname?: string }): void {
  const envContent = `
NAISYS_FOLDER="${options?.naisysFolder ?? ""}"
NAISYS_HOSTNAME="${options?.hostname ?? "TEST-HOST"}"
SPEND_LIMIT_DOLLARS=10
`.trim();
  writeFileSync(join(testDir, ".env"), envContent);
}

/**
 * Create an agent YAML file
 */
export function createAgentYaml(testDir: string, filename: string, config: AgentYamlConfig): void {
  let yamlContent = `
username: ${config.username}
title: ${config.title}
shellModel: ${config.shellModel ?? "none"}
agentPrompt: |
  ${config.agentPrompt ?? `You are \${agent.username} a \${agent.title} for testing.`}
tokenMax: ${config.tokenMax ?? 50000}
debugPauseSeconds: ${config.debugPauseSeconds ?? 0}
spendLimitDollars: ${config.spendLimitDollars ?? 10.0}
webEnabled: ${config.webEnabled ?? false}
mailEnabled: ${config.mailEnabled ?? true}
wakeOnMessage: ${config.wakeOnMessage ?? false}
`.trim();

  // Add optional properties
  if (config.subagentMax !== undefined) {
    yamlContent += `\nsubagentMax: ${config.subagentMax}`;
  }

  writeFileSync(join(testDir, filename), yamlContent);
}

/**
 * Create an agent YAML file in a subdirectory (e.g., agents/)
 */
export function createAgentYamlInDir(testDir: string, subdir: string, filename: string, config: AgentYamlConfig): void {
  const agentsDir = join(testDir, subdir);
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }
  createAgentYaml(agentsDir, filename, config);
}

/**
 * Get the path to naisys.js
 */
export function getNaisysPath(): string {
  return resolve(__dirname, "../../../dist/naisys.js");
}

/**
 * Spawn a naisys process for testing
 */
export function spawnNaisys(testDir: string, args: string[] = []): NaisysTestProcess {
  const naisysPath = getNaisysPath();

  const proc = spawn("node", [naisysPath, ...args], {
    cwd: testDir,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];

  proc.stdout?.on("data", (data) => {
    stdout.push(data.toString());
  });

  proc.stderr?.on("data", (data) => {
    stderr.push(data.toString());
  });

  const sendCommand = (command: string) => {
    proc.stdin?.write(command + "\n");
  };

  const sendNewLine = () => {
    proc.stdin?.write("\n");
  };

  const waitForOutput = async (text: string, timeoutMs = 10000): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const fullOutput = stdout.join("");
      if (fullOutput.includes(text)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for "${text}" in output. Got:\n${stdout.join("")}`
    );
  };

  const waitForOutputCount = async (text: string, count: number, timeoutMs = 10000): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const fullOutput = stdout.join("");
      const matches = fullOutput.split(text).length - 1;
      if (matches >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for "${text}" to appear ${count} times in output. Got:\n${stdout.join("")}`
    );
  };

  const waitForPrompt = async (promptCount = 1, timeoutMs = 10000): Promise<void> => {
    // [Tokens: X/Y] appears in every prompt line
    await waitForOutputCount("[Tokens:", promptCount, timeoutMs);
    // Small delay to ensure prompt is fully ready
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  const getFullOutput = () => stdout.join("");

  const cleanup = async (): Promise<void> => {
    // Close stdin first
    proc.stdin?.end();

    // Remove all listeners to prevent Jest open handle warnings
    proc.stdin?.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    proc.removeAllListeners();

    if (!proc.killed) {
      proc.kill("SIGTERM");
    }

    // Wait for process to fully exit
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
      } else {
        proc.on("exit", () => resolve());
        setTimeout(resolve, 2000);
      }
    });
  };

  return {
    process: proc,
    stdout,
    stderr,
    sendCommand,
    sendNewLine,
    waitForOutput,
    waitForOutputCount,
    waitForPrompt,
    getFullOutput,
    cleanup,
  };
}

/**
 * Wait for process to exit and return the exit code
 */
export async function waitForExit(proc: ChildProcess, timeoutMs = 5000): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
    } else {
      proc.on("exit", (code) => resolve(code));
      setTimeout(() => resolve(null), timeoutMs);
    }
  });
}
