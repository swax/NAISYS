import { execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";

import { ADMIN_USERNAME } from "@naisys/common";
import { getGitCommitHash, getGitRepoRoot } from "@naisys/common-node";

import type { AgentManager } from "../agent/agentManager.js";
import type { GlobalConfig } from "../globalConfig.js";
import { getInstallPath } from "./pathService.js";

/**
 * Parse a target version string into npm version and commit hash parts.
 * Format: "npmVersion/commitHash" — either part may be empty.
 * Examples: "1.2.3/abc123", "1.2.3", "/abc123"
 */
function parseTargetVersion(target: string) {
  const slashIndex = target.indexOf("/");
  if (slashIndex === -1) {
    return { npmVersion: target, commitHash: "" };
  }
  return {
    npmVersion: target.substring(0, slashIndex),
    commitHash: target.substring(slashIndex + 1),
  };
}

export function createUpdateService(
  globalConfig: GlobalConfig,
  agentManager: AgentManager,
) {
  let updateInProgress = false;
  const repoRoot = getGitRepoRoot(getInstallPath());

  // Check for updates on startup and whenever config changes
  void checkForUpdate();
  globalConfig.onConfigChanged(() => void checkForUpdate());

  async function checkForUpdate() {
    if (updateInProgress) return;

    const targetVersion =
      globalConfig.globalConfig()?.variableMap.TARGET_VERSION;
    if (!targetVersion) return;

    const { npmVersion, commitHash } = parseTargetVersion(targetVersion);

    // Determine if this target is relevant for our install type
    if (repoRoot) {
      if (!commitHash) return; // No hash in target, not for git clients
      const currentHash = getGitCommitHash(getInstallPath());
      if (commitHash === currentHash) return; // Already on this commit
    } else {
      if (!npmVersion) return; // No version in target, not for npm clients
      const currentVersion = globalConfig.globalConfig().packageVersion;
      if (npmVersion === currentVersion) return; // Already on this version
    }

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

    let success: boolean;
    if (repoRoot) {
      success = await performGitUpdate(commitHash, repoRoot, log, logError);
    } else {
      success = await performNpmUpdate(npmVersion, log, logError);
    }

    if (!success) {
      updateInProgress = false;
      return;
    }

    log(`Update installed. Stopping agents for restart...`);

    try {
      await Promise.all(
        agentManager.runningAgents.map((agent) =>
          agentManager.stopAgent(
            agent.agentUserId,
            `Switching to version ${targetVersion}`,
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
  }

  return {
    isUpdateInProgress: () => updateInProgress,
  };

  async function performGitUpdate(
    targetHash: string,
    repoRoot: string,
    log: (msg: string) => void,
    logError: (msg: string) => void,
  ): Promise<boolean> {
    const currentHash = getGitCommitHash(getInstallPath())!;
    log(
      `Git update: ${currentHash.substring(0, 8)} → ${targetHash.substring(0, 8)}`,
    );

    // Check for dirty working tree
    try {
      const status = execSync("git status --porcelain", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (status) {
        logError(`Cannot update: working tree is not clean\n${status}`);
        return false;
      }
    } catch (error) {
      logError(`Failed to check git status: ${error}`);
      return false;
    }

    // Fetch to ensure we have the target commit (best effort)
    log(`Fetching latest commits...`);
    try {
      await runSpawn("git", ["fetch"], repoRoot);
    } catch {
      log(`git fetch failed, will try checkout with local commits...`);
    }

    // Checkout target commit
    log(`Checking out ${targetHash.substring(0, 8)}...`);
    try {
      await runSpawn("git", ["checkout", targetHash], repoRoot);
    } catch (error) {
      logError(`git checkout failed: ${error}`);
      return false;
    }

    // Install dependencies from repo root
    log(`Running npm install...`);
    try {
      await runSpawn("npm", ["install"], repoRoot);
    } catch (error) {
      logError(
        `npm install failed, rolling back to ${currentHash.substring(0, 8)}...`,
      );
      await rollbackGit(currentHash, repoRoot, logError);
      return false;
    }

    // Build from repo root
    log(`Running npm run build...`);
    try {
      await runSpawn("npm", ["run", "build"], repoRoot);
    } catch (error) {
      logError(
        `Build failed, rolling back to ${currentHash.substring(0, 8)}...`,
      );
      await rollbackGit(currentHash, repoRoot, logError);
      return false;
    }

    log(`Git update complete.`);
    return true;
  }

  async function rollbackGit(
    previousHash: string,
    repoRoot: string,
    logError: (msg: string) => void,
  ) {
    try {
      await runSpawn("git", ["checkout", previousHash], repoRoot);
      await runSpawn("npm", ["install"], repoRoot);
      await runSpawn("npm", ["run", "build"], repoRoot);
    } catch (rollbackError) {
      logError(`Rollback also failed: ${rollbackError}`);
    }
  }

  async function performNpmUpdate(
    targetVersion: string,
    log: (msg: string) => void,
    logError: (msg: string) => void,
  ): Promise<boolean> {
    const currentVersion = globalConfig.globalConfig().packageVersion;
    log(`npm update: ${currentVersion} → ${targetVersion}`);

    const packages = detectInstalledNaisysPackages();
    if (!packages.length) {
      logError(
        `Cannot auto-update: no naisys packages found in package.json`,
      );
      return false;
    }

    const installArgs = packages.map((p) => `${p}@${targetVersion}`);
    log(`Installing: npm install ${installArgs.join(" ")}`);

    try {
      await runSpawn("npm", ["install", ...installArgs]);
    } catch (error) {
      logError(`npm install failed: ${error}`);
      return false;
    }

    return true;
  }
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
function runSpawn(
  command: string,
  args: string[],
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}