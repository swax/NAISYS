import { sleep } from "@naisys/common";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import type { Page } from "playwright";
import { fileURLToPath } from "url";

/**
 * Dump the browser's `window.__coverage__` (set by vite-plugin-istanbul
 * when the client is built with COVERAGE=1) to a JSON file the root
 * coverage script merges in. The destination directory comes from
 * `COVERAGE_CLIENT_RAW_DIR` (set by `scripts/run-coverage.mjs`). No-op
 * when the page wasn't instrumented or the env var isn't set.
 */
export async function dumpClientCoverage(page: Page): Promise<void> {
  const outDir = process.env.COVERAGE_CLIENT_RAW_DIR;
  if (!outDir) return;

  const coverage = await page.evaluate(
    () => (globalThis as { __coverage__?: unknown }).__coverage__ ?? null,
  );
  if (!coverage) return;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, `${randomUUID()}.json`),
    JSON.stringify(coverage),
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface RunCommandOptions {
  /** Substring to wait for in output before waiting for prompt */
  waitFor?: string;
  /** Timeout for waitFor and the prompt wait */
  timeoutMs?: number;
  /** Flush output before sending (default: true) */
  flush?: boolean;
  /** Wait for a prompt after the command completes (default: true) */
  waitForPrompt?: boolean;
}

export interface NaisysTestProcess {
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  sendCommand: (command: string) => void;
  sendNewLine: () => void;
  /** Wait for text to appear in output since last flush */
  waitForOutput: (text: string, timeoutMs?: number) => Promise<void>;
  /** Wait for text to appear N times in output since last flush */
  waitForOutputCount: (
    text: string,
    count: number,
    timeoutMs?: number,
  ) => Promise<void>;
  /** Wait for one prompt to appear since last flush */
  waitForPrompt: (timeoutMs?: number) => Promise<void>;
  /**
   * Flush, send command, optionally wait for a substring, then wait for prompt.
   * Returns the output captured between the flush and the prompt.
   */
  runCommand: (
    command: string,
    options?: RunCommandOptions,
  ) => Promise<string>;
  /** Press enter (blank line) and wait for the next prompt */
  pressEnter: (options?: { waitForPrompt?: boolean }) => Promise<string>;
  /** Run `ns-agent start <username> "<reason>"` and wait for "started" */
  startAgent: (username: string, reason: string) => Promise<string>;
  /** Run `ns-agent switch <username>` and wait for the new prompt */
  switchAgent: (username: string) => Promise<string>;
  /** Run `ns-mail send "<to>" "<subject>" "<body>"` and wait for "Mail sent" */
  sendMail: (to: string, subject: string, body: string) => Promise<string>;
  /** Run `ns-mail read <messageId>` and return the output */
  readMail: (messageId: string | number) => Promise<string>;
  getFullOutput: () => string;
  /** Returns output since last flush and resets the flush position */
  flushOutput: () => string;
  /** Log the full output to console for debugging */
  dumpOutput: () => void;
  /** Print stderr to console with an optional label, only if non-empty */
  dumpStderrIfAny: (label?: string) => void;
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
  mailEnabled?: boolean;
  chatEnabled?: boolean;
  webEnabled?: boolean;
  wakeOnMessage?: boolean;
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
export function createEnvFile(
  testDir: string,
  options?: { naisysFolder?: string; hostname?: string },
): void {
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
export function createAgentYaml(
  testDir: string,
  filename: string,
  config: AgentYamlConfig,
): void {
  const debugPauseLine =
    config.debugPauseSeconds !== undefined
      ? `debugPauseSeconds: ${config.debugPauseSeconds}\n`
      : "";

  let yamlContent = `
username: ${config.username}
title: ${config.title}
shellModel: ${config.shellModel ?? "none"}
agentPrompt: |
  ${config.agentPrompt ?? `You are \${agent.username} a \${agent.title} for testing.`}
tokenMax: ${config.tokenMax ?? 50000}
${debugPauseLine}spendLimitDollars: ${config.spendLimitDollars ?? 10.0}
mailEnabled: ${config.mailEnabled ?? false}
chatEnabled: ${config.chatEnabled ?? false}
webEnabled: ${config.webEnabled ?? false}
wakeOnMessage: ${config.wakeOnMessage ?? false}
`.trim();

  writeFileSync(join(testDir, filename), yamlContent);
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
  options: { port: number; naisysFolder: string },
): void {
  const envContent = `
NAISYS_FOLDER=${options.naisysFolder}
SERVER_PORT=${options.port}
`.trim();
  writeFileSync(join(testDir, ".env"), envContent);
}

/**
 * Extract the hub access key by reading it from the cert directory.
 * The hub writes the key to ${naisysFolder}/cert/hub-access-key on startup.
 */
export function extractAccessKey(naisysFolder: string): string {
  const keyPath = join(naisysFolder, "cert", "hub-access-key");
  if (!existsSync(keyPath)) {
    throw new Error(`Hub access key file not found at: ${keyPath}`);
  }
  return readFileSync(keyPath, "utf-8").trim();
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
      NODE_OPTIONS: "",
      VITEST: "",
      VITEST_WORKER_ID: "",
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

  const waitForOutput = async (
    text: string,
    timeoutMs = 10000,
  ): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (stdout.join("").includes(text)) {
        return;
      }
      await sleep(100);
    }

    throw new Error(
      `Timeout waiting for "${text}" in hub output. Got:\n${stdout.join("")}`,
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
  /** Extra environment variables to set (overrides process.env) */
  env?: Record<string, string>;
}

/**
 * Spawn a naisys process for testing
 */
export function spawnNaisys(
  testDir: string,
  options: SpawnNaisysOptions = {},
): NaisysTestProcess {
  const { args = [], debug = false, env: extraEnv = {} } = options;
  const naisysPath = getNaisysPath();

  const proc = spawn("node", [naisysPath, ...args], {
    cwd: testDir,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NAISYS_DISABLE_RESTART_WRAPPER: "1",
      NODE_OPTIONS: "",
      VITEST: "",
      VITEST_WORKER_ID: "",
      ...extraEnv,
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

  const waitForOutput = async (
    text: string,
    timeoutMs = 10000,
  ): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (getOutputSinceFlush().includes(text)) {
        return;
      }
      await sleep(100);
    }

    throw new Error(
      `Timeout waiting for "${text}" in output since flush. Got:\n${getOutputSinceFlush()}\n\nstderr:\n${stderr.join("")}\n\nexitCode:${proc.exitCode}`,
    );
  };

  const waitForOutputCount = async (
    text: string,
    count: number,
    timeoutMs = 10000,
  ): Promise<void> => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const output = getOutputSinceFlush();
      const matches = output.split(text).length - 1;
      if (matches >= count) {
        return;
      }
      await sleep(100);
    }

    throw new Error(
      `Timeout waiting for "${text}" to appear ${count} times since flush. Got:\n${getOutputSinceFlush()}\n\nstderr:\n${stderr.join("")}\n\nexitCode:${proc.exitCode}`,
    );
  };

  const waitForPrompt = async (timeoutMs = 10000): Promise<void> => {
    // [Tokens: X/Y] appears in every prompt line - wait for one since last flush
    await waitForOutputCount("[Tokens:", 1, timeoutMs);
    // Small delay to ensure prompt is fully ready
    await sleep(300);
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

  const dumpStderrIfAny = (label?: string) => {
    if (stderr.length > 0) {
      const prefix = label ? `${label} stderr:` : "stderr:";
      console.log(prefix, stderr.join(""));
    }
  };

  const runCommand = async (
    command: string,
    options: RunCommandOptions = {},
  ): Promise<string> => {
    const {
      waitFor,
      timeoutMs = 10000,
      flush = true,
      waitForPrompt: shouldWaitForPrompt = true,
    } = options;

    if (flush) {
      flushOutput();
    }
    sendCommand(command);
    if (waitFor !== undefined) {
      await waitForOutput(waitFor, timeoutMs);
    }
    if (shouldWaitForPrompt) {
      await waitForPrompt(timeoutMs);
    }
    return flushOutput();
  };

  const pressEnter = async (
    options: { waitForPrompt?: boolean } = {},
  ): Promise<string> => {
    const { waitForPrompt: shouldWaitForPrompt = true } = options;
    flushOutput();
    sendNewLine();
    if (shouldWaitForPrompt) {
      await waitForPrompt();
    }
    return flushOutput();
  };

  const startAgent = (username: string, reason: string) =>
    runCommand(`ns-agent start ${username} "${reason}"`, {
      waitFor: "started",
      timeoutMs: 15000,
    });

  const switchAgent = (username: string) =>
    runCommand(`ns-agent switch ${username}`, {
      waitFor: `${username}@`,
      timeoutMs: 15000,
    });

  const sendMail = (to: string, subject: string, body: string) =>
    runCommand(`ns-mail send "${to}" "${subject}" "${body}"`, {
      waitFor: "Mail sent",
      timeoutMs: 15000,
    });

  const readMail = (messageId: string | number) =>
    runCommand(`ns-mail read ${messageId}`, { timeoutMs: 10000 });

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
    runCommand,
    pressEnter,
    startAgent,
    switchAgent,
    sendMail,
    readMail,
    getFullOutput,
    flushOutput,
    dumpOutput,
    dumpStderrIfAny,
    cleanup,
  };
}

/**
 * Wait for process to exit and return the exit code
 */
export async function waitForExit(
  proc: ChildProcess,
  timeoutMs = 5000,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
    } else {
      proc.on("exit", (code) => resolve(code));
      setTimeout(() => resolve(null), timeoutMs);
    }
  });
}
