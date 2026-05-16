import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

let cachedRepoRoot: string | null | undefined;
let cachedCommitHash: string | null | undefined;

/**
 * Returns the git repo root, or null if not running from a git repo.
 * Result is cached for the lifetime of the process.
 * @param startDir Directory to check from (defaults to process.cwd())
 */
export function getGitRepoRoot(startDir?: string): string | null {
  if (cachedRepoRoot !== undefined) return cachedRepoRoot;
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: startDir ?? process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Verify this is actually the NAISYS monorepo, not a user's project
    // that happens to contain naisys as an npm dependency in node_modules
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    cachedRepoRoot = pkg.name === "naisys-monorepo" ? root : null;
  } catch {
    cachedRepoRoot = null;
  }
  return cachedRepoRoot;
}

/**
 * Returns the full commit hash, or null if not in a git repo.
 * Result is cached for the lifetime of the process.
 * @param startDir Directory to check from (defaults to process.cwd())
 */
export function getGitCommitHash(startDir?: string): string | null {
  if (cachedCommitHash !== undefined) return cachedCommitHash;
  const repoRoot = getGitRepoRoot(startDir);
  if (!repoRoot) {
    cachedCommitHash = null;
    return null;
  }
  try {
    cachedCommitHash = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    cachedCommitHash = null;
  }
  return cachedCommitHash;
}
