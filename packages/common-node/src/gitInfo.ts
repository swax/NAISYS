import { execSync } from "child_process";

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
    cachedRepoRoot = execSync("git rev-parse --show-toplevel", {
      cwd: startDir ?? process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
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
