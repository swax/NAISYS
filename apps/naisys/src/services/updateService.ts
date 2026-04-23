import { ADMIN_USERNAME, compareSemver, parseVersion } from "@naisys/common";
import { getGitCommitHash, getGitRepoRoot } from "@naisys/common-node";
import { execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";

import type { AgentManager } from "../agent/agentManager.js";
import type { GlobalConfig } from "../globalConfig.js";
import { getInstallPath } from "./pathService.js";
import { isRestartWrapperActive, RESTART_EXIT_CODE } from "./restartManager.js";

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

    const {
      operator,
      npm: npmVersion,
      hash: commitHash,
    } = parseVersion(targetVersion);

    // Determine if this target is relevant for our install type
    if (repoRoot) {
      if (!commitHash) return; // No hash in target, not for git clients
      const currentHash = getGitCommitHash(getInstallPath());
      if (commitHash === currentHash) return; // Already on this commit
    } else {
      if (!npmVersion) return; // No version in target, not for npm clients
      const currentVersion = globalConfig.globalConfig().packageVersion;
      if (operator === ">=") {
        if (compareSemver(currentVersion, npmVersion) >= 0) return; // Already at or above floor
      } else if (npmVersion === currentVersion) {
        return; // Already on this version
      }
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
      logError(`Version change failed, continuing on current version.`);
      updateInProgress = false;
      return;
    }

    log(`Update installed. Stopping agents for restart...`);

    try {
      await agentManager.stopAll(`Switching to version ${targetVersion}`);
    } catch (error) {
      logError(`Error stopping agents: ${error}`);
    }

    if (process.env.pm_id) {
      log(`Exiting — PM2 will restart`);
      process.exit(0);
    }

    if (isRestartWrapperActive()) {
      log(`Requesting wrapper restart...`);
      log(`Exiting — wrapper will restart`);
      process.exit(RESTART_EXIT_CODE);
    }

    log(
      `No restart manager active. Restart NAISYS manually to use the update.`,
    );
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

    // Stash any local changes (e.g. package-lock.json, file mode changes from install)
    let didStash = false;
    try {
      const stashOutput = execSync('git stash push -m "NAISYS auto-update"', {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      didStash = !stashOutput.includes("No local changes");
      if (didStash) log(`Stashed local changes`);
    } catch (error) {
      logError(`Failed to stash local changes: ${error}`);
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

    // Clean install to avoid stale/misresolved packages from the previous commit
    log(`Running npm ci...`);
    try {
      await runSpawn("npm", ["ci"], repoRoot);
    } catch (_error) {
      logError(
        `npm install failed, rolling back to ${currentHash.substring(0, 8)}...`,
      );
      await rollbackGit(currentHash, repoRoot, didStash, logError);
      return false;
    }

    // Clean stale build artifacts and turbo cache, then build
    log(`Running npm run clean...`);
    try {
      await runSpawn("npm", ["run", "clean"], repoRoot);
    } catch {
      // clean failing is non-fatal
    }

    log(`Running npm run build...`);
    try {
      await runSpawn("npm", ["run", "build"], repoRoot);
    } catch (_error) {
      logError(
        `Build failed, rolling back to ${currentHash.substring(0, 8)}...`,
      );
      await rollbackGit(currentHash, repoRoot, didStash, logError);
      return false;
    }

    log(`Git update complete.`);
    return true;
  }

  async function rollbackGit(
    previousHash: string,
    repoRoot: string,
    popStash: boolean,
    logError: (msg: string) => void,
  ) {
    try {
      // Clean working tree first (e.g. package-lock.json changed by target's npm install)
      // so checkout and stash pop don't conflict with dirty files
      await runSpawn("git", ["restore", "."], repoRoot);
      await runSpawn("git", ["checkout", previousHash], repoRoot);
      if (popStash) await runSpawn("git", ["stash", "pop"], repoRoot);
      await runSpawn("npm", ["install"], repoRoot);
      await runSpawn("npm", ["run", "build"], repoRoot);
    } catch (rollbackError) {
      logError(`Rollback also failed: ${rollbackError}`);
    }
  }

  async function rollbackNpm(
    packages: string[],
    previousVersion: string,
    logError: (msg: string) => void,
  ) {
    const rollbackArgs = packages.map((p) => `${p}@${previousVersion}`);
    logError(`Rolling back to ${previousVersion}...`);
    try {
      await runSpawn("npm", ["install", ...rollbackArgs]);
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
      logError(`Cannot auto-update: no naisys packages found in package.json`);
      return false;
    }

    const installArgs = packages.map((p) => `${p}@${targetVersion}`);
    log(`Installing: npm install ${installArgs.join(" ")}`);

    try {
      await runSpawn("npm", ["install", ...installArgs]);
    } catch (error) {
      logError(`npm install failed: ${error}`);
      await rollbackNpm(packages, currentVersion, logError);
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
    // Avoid shell:true — args containing shell metacharacters (e.g. ">=1.2.3")
    // would otherwise be interpreted by the shell as redirects. On Windows,
    // npm/npx ship as .cmd wrappers that aren't directly executable.
    const isWindows = process.platform === "win32";
    const needsCmdSuffix =
      isWindows && (command === "npm" || command === "npx");
    const resolvedCommand = needsCmdSuffix ? `${command}.cmd` : command;
    const child = spawn(resolvedCommand, args, {
      cwd: cwd ?? process.cwd(),
      stdio: "inherit",
      env: { ...process.env, npm_config_yes: "true", NODE_ENV: "" },
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
