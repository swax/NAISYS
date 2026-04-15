import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getGitCommitHash } from "@naisys/common-node";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the server's own package.json (one level up from dist/)
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const commitHash = getGitCommitHash(__dirname);

export function getPackageVersion(): string {
  return commitHash ? `${pkg.version}/${commitHash}` : pkg.version;
}
