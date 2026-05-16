import semver from "semver";

/**
 * Parse a version string that may contain ">=" operator and/or "/commitHash".
 * ">=1.2.3"         → { operator: ">=", npm: "1.2.3", hash: "" }
 * "1.2.3/abc123..." → { operator: "",   npm: "1.2.3", hash: "abc123..." }
 * "1.2.3"           → { operator: "",   npm: "1.2.3", hash: "" }
 * "/abc123..."      → { operator: "",   npm: "",      hash: "abc123..." }
 */
export function parseVersion(version: string): {
  operator: "" | ">=";
  npm: string;
  hash: string;
} {
  let operator: "" | ">=" = "";
  let rest = version;
  if (rest.startsWith(">=")) {
    operator = ">=";
    rest = rest.substring(2);
  }
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) return { operator, npm: rest, hash: "" };
  return {
    operator,
    npm: rest.substring(0, slashIndex),
    hash: rest.substring(slashIndex + 1),
  };
}

/**
 * Format a version string for display.
 * ">=1.2.3"              → ">=1.2.3"
 * "1.2.3/abc123def456…"  → "1.2.3 (abc123de)"
 * "1.2.3"                → "1.2.3"
 * "/abc123def456…"       → "abc123de"
 */
export function formatVersion(version: string): string {
  const { operator, npm, hash } = parseVersion(version);
  if (!hash) return `${operator}${npm}`;
  const shortHash = hash.substring(0, 8);
  if (npm) return `${operator}${npm} (${shortHash})`;
  return shortHash;
}

/**
 * Check if an instance version satisfies the target version.
 * - If target has a hash, the instance must have the same hash.
 * - If target npm has ">=" operator, instance npm must be >= target npm.
 * - Otherwise, npm versions must match exactly.
 */
export function versionsMatch(
  instanceVersion: string,
  targetVersion: string,
): boolean {
  const target = parseVersion(targetVersion);
  const instance = parseVersion(instanceVersion);

  if (target.hash) {
    return instance.hash === target.hash;
  }
  if (target.operator === ">=") {
    return semver.gte(instance.npm, target.npm);
  }
  return instance.npm === target.npm;
}

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  return semver.compare(a, b);
}
