import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";

import { ADMIN_USERNAME } from "@naisys/common";

import type { AgentManager } from "../agent/agentManager.js";
import type { GlobalConfig } from "../globalConfig.js";

export function createUpdateService(
  globalConfig: GlobalConfig,
  agentManager: AgentManager,
) {
  let updateInProgress = false;

  globalConfig.onUpdateAvailable(async (targetVersion) => {
    if (updateInProgress) return;
    updateInProgress = true;

    // Grab admin agent's output for hub-visible logging (before we stop agents)
    const output = (
      agentManager.runningAgents.find(
        (a) => a.agentUsername === ADMIN_USERNAME,
      ) ?? agentManager.runningAgents[0]
    )?.output;

    const log = (msg: string) =>
      output ? output.commentAndLog(msg) : console.log(`[NAISYS] ${msg}`);
    const logError = (msg: string) =>
      output ? output.errorAndLog(msg) : console.error(`[NAISYS] ${msg}`);

    const currentVersion = globalConfig.globalConfig().packageVersion;
    log(`Update available: ${currentVersion} → ${targetVersion}`);

    const packages = detectInstalledNaisysPackages();
    if (!packages.length) {
      logError(`Cannot auto-update: no naisys packages found in package.json`);
      updateInProgress = false;
      return;
    }

    const installArgs = packages.map((p) => `${p}@${targetVersion}`);
    log(`Installing: npm install ${installArgs.join(" ")}`);

    try {
      await runSpawn("npm", ["install", ...installArgs]);
    } catch (error) {
      logError(`npm install failed: ${error}`);
      updateInProgress = false;
      return;
    }

    log(`Update installed. Stopping agents for restart...`);

    try {
      await Promise.all(
        agentManager.runningAgents.map((agent) =>
          agentManager.stopAgent(
            agent.agentUserId,
            `Updating to version ${targetVersion}`,
          ),
        ),
      );
    } catch (error) {
      logError(`Error stopping agent: ${error}`);
    }

    // If not managed by PM2, respawn as a detached process before exiting
    if (!process.env.pm_id) {
      log(`Spawning new process for restart...`);
      const child = spawn(process.argv[0], process.argv.slice(1), {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }

    log(`Exiting for restart...`);
    process.exit(0);
  });

  return {
    isUpdateInProgress: () => updateInProgress,
  };
}

/** Read the user's package.json to find installed naisys packages */
function detectInstalledNaisysPackages(): string[] {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).filter(
      (name) => name === "naisys" || name.startsWith("@naisys/"),
    );
  } catch {
    return [];
  }
}

/** Spawn a command and wait for completion */
function runSpawn(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
