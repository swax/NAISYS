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
  /** Wait for text to appear in output since last flush */
  waitForOutput: (text: string, timeoutMs?: number) => Promise<void>;
  /** Wait for text to appear N times in output since last flush */
  waitForOutputCount: (text: string, count: number, timeoutMs?: number) => Promise<void>;
  /** Wait for one prompt to appear since last flush */
  waitForPrompt: (timeoutMs?: number) => Promise<void>;
  getFullOutput: () => string;
  /** Returns output since last flush and resets the flush position */
  flushOutput: () => string;
  /** Log the full output to console for debugging */
  dumpOutput: () => void;
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
 * Get the path to naisysHub.js
 */
export function getHubPath(): string {
  return resolve(__dirname, "../../../../hub/dist/naisysHub.js");
}

/**
 * Create a hub .env file for testing
 */
export function createHubEnvFile(
  testDir: string,
  options: { port: number; accessKey: string }
): void {
  const envContent = `
NAISYS_FOLDER=""
HUB_PORT=${options.port}
HUB_ACCESS_KEY=${options.accessKey}
`.trim();
  writeFileSync(join(testDir, ".env"), envContent);
}

/**
 * Create a naisys .env file with hub connection for testing
 */
export function createEnvFileWithHub(
  testDir: string,
  options: {
    hostname: string;
    hubUrl: string;
    hubAccessKey: string;
  }
): void {
  const envContent = `
NAISYS_FOLDER=""
NAISYS_HOSTNAME="${options.hostname}"
SPEND_LIMIT_DOLLARS=10
HUB_URLS="${options.hubUrl}"
HUB_ACCESS_KEY=${options.hubAccessKey}
`.trim();
  writeFileSync(join(testDir, ".env"), envContent);
}

export interface HubTestProcess {
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  /** Wait for text to appear in output */
  waitForOutput: (text: string, timeoutMs?: number) => Promise<void>;
  getFullOutput: () => string;
  cleanup: () => Promise<void>;
}

/**
 * Spawn a hub server process for testing
 */
export function spawnHub(testDir: string, debug = false): HubTestProcess {
  const hubPath = getHubPath();

  const proc = spawn("node", [hubPath], {
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
    const str = data.toString();
    stdout.push(str);
    if (debug) {
      process.stdout.write(`[HUB] ${str}`);
    }
  });

  proc.stderr?.on("data", (data) => {
    const str = data.toString();
    stderr.push(str);
    if (debug) {
      process.stderr.write(`[HUB ERR] ${str}`);
    }
  });

  const waitForOutput = async (text: string, timeoutMs = 10000): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (stdout.join("").includes(text)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for "${text}" in hub output. Got:\n${stdout.join("")}`
    );
  };

  const getFullOutput = () => stdout.join("");

  const cleanup = async (): Promise<void> => {
    proc.stdin?.end();
    proc.stdin?.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    proc.removeAllListeners();

    if (!proc.killed) {
      proc.kill("SIGTERM");
    }

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
    waitForOutput,
    getFullOutput,
    cleanup,
  };
}

export interface SpawnNaisysOptions {
  args?: string[];
  /** Enable debug output - logs all stdout to console in real-time */
  debug?: boolean;
}

/**
 * Spawn a naisys process for testing
 */
export function spawnNaisys(testDir: string, options: SpawnNaisysOptions = {}): NaisysTestProcess {
  const { args = [], debug = false } = options;
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
  let flushIndex = 0;

  proc.stdout?.on("data", (data) => {
    const str = data.toString();
    stdout.push(str);
    if (debug) {
      process.stdout.write(str);
    }
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

  const getOutputSinceFlush = () => stdout.slice(flushIndex).join("");

  const waitForOutput = async (text: string, timeoutMs = 10000): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (getOutputSinceFlush().includes(text)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for "${text}" in output since flush. Got:\n${getOutputSinceFlush()}`
    );
  };

  const waitForOutputCount = async (text: string, count: number, timeoutMs = 10000): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const output = getOutputSinceFlush();
      const matches = output.split(text).length - 1;
      if (matches >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(
      `Timeout waiting for "${text}" to appear ${count} times since flush. Got:\n${getOutputSinceFlush()}`
    );
  };

  const waitForPrompt = async (timeoutMs = 10000): Promise<void> => {
    // [Tokens: X/Y] appears in every prompt line - wait for one since last flush
    await waitForOutputCount("[Tokens:", 1, timeoutMs);
    // Small delay to ensure prompt is fully ready
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  const getFullOutput = () => stdout.join("");

  const flushOutput = () => {
    const output = stdout.slice(flushIndex).join("");
    flushIndex = stdout.length;
    return output;
  };

  const dumpOutput = () => {
    console.log("=== NAISYS OUTPUT START ===");
    console.log(stdout.join(""));
    console.log("=== NAISYS OUTPUT END ===");
    if (stderr.length > 0) {
      console.log("=== STDERR ===");
      console.log(stderr.join(""));
    }
  };

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
    flushOutput,
    dumpOutput,
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
