import type { ChildProcess } from "child_process";
import { spawn } from "child_process";

/** 75 = EX_TEMPFAIL, reused here as an internal "restart requested" exit code. */
export const RESTART_EXIT_CODE = 75;
export const RESTART_WRAPPER_ACTIVE_ENV = "NAISYS_RESTART_WRAPPER_ACTIVE";
export const RESTART_WRAPPER_CHILD_ENV = "NAISYS_RESTART_WRAPPER_CHILD";
export const DISABLE_RESTART_WRAPPER_ENV = "NAISYS_DISABLE_RESTART_WRAPPER";

const POSIX_FORWARD_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const WINDOWS_FORWARD_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export function isRestartWrapperActive(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[RESTART_WRAPPER_ACTIVE_ENV] === "1";
}

export function shouldUseRestartWrapper(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const usesHub =
    argv.some((arg) => arg === "--hub" || arg.startsWith("--hub=")) ||
    argv.includes("--integrated-hub");
  const autoUpdateDisabled = argv.includes("--no-auto-update");

  return (
    usesHub &&
    !autoUpdateDisabled &&
    !env.pm_id &&
    env[RESTART_WRAPPER_CHILD_ENV] !== "1" &&
    env[DISABLE_RESTART_WRAPPER_ENV] !== "1"
  );
}

export function getRestartWrapperSignals(
  platform: NodeJS.Platform = process.platform,
): NodeJS.Signals[] {
  return platform === "win32" ? WINDOWS_FORWARD_SIGNALS : POSIX_FORWARD_SIGNALS;
}

export function getExitCodeForSignal(
  signal: NodeJS.Signals | null | undefined,
): number {
  if (!signal) return 1;
  return SIGNAL_EXIT_CODES[signal] ?? 1;
}

export async function runWithRestartWrapper(): Promise<number> {
  let activeChild: ChildProcess | null = null;

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (activeChild && activeChild.exitCode === null) {
      activeChild.kill(signal);
    }
  };

  for (const signal of getRestartWrapperSignals()) {
    process.on(signal, () => forwardSignal(signal));
  }

  while (true) {
    activeChild = spawn(process.argv[0], process.argv.slice(1), {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        [RESTART_WRAPPER_ACTIVE_ENV]: "1",
        [RESTART_WRAPPER_CHILD_ENV]: "1",
      },
    });

    const exitCode = await waitForExit(activeChild);
    activeChild = null;

    if (exitCode === RESTART_EXIT_CODE) {
      console.log("[NAISYS] Restarting...");
      continue;
    }

    return exitCode;
  }
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? getExitCodeForSignal(signal));
    });
  });
}
