/**
 * Parse a version string that may contain "npmVersion/commitHash".
 * "1.2.3/abc123..." → { npm: "1.2.3", hash: "abc123..." }
 * "1.2.3"          → { npm: "1.2.3", hash: "" }
 * "/abc123..."     → { npm: "", hash: "abc123..." }
 */
export function parseVersion(version: string): {
  npm: string;
  hash: string;
} {
  const slashIndex = version.indexOf("/");
  if (slashIndex === -1) return { npm: version, hash: "" };
  return {
    npm: version.substring(0, slashIndex),
    hash: version.substring(slashIndex + 1),
  };
}

/**
 * Format a version string for display.
 * "1.2.3/abc123def456..." → "1.2.3 (abc123de)"
 * "1.2.3" → "1.2.3"
 * "/abc123def456..." → "abc123de"
 */
export function formatVersion(version: string): string {
  const { npm, hash } = parseVersion(version);
  if (!hash) return npm;
  const shortHash = hash.substring(0, 8);
  if (npm) return `${npm} (${shortHash})`;
  return shortHash;
}

/**
 * Check if an instance version matches the target version.
 * Handles the "npmVersion/commitHash" format:
 * - If target has a hash, the instance must have the same hash to match.
 * - Otherwise, npm version parts are compared.
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
  return instance.npm === target.npm;
}
