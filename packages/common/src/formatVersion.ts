/**
 * Format a version string that may contain a git commit hash suffix.
 * "1.2.3/abc123def456..." → "1.2.3 (abc123de)"
 * "1.2.3" → "1.2.3"
 * "/abc123def456..." → "abc123de"
 */
export function formatVersion(version: string): string {
  const slashIndex = version.indexOf("/");
  if (slashIndex === -1) return version;
  const npmVer = version.substring(0, slashIndex);
  const hash = version.substring(slashIndex + 1);
  const shortHash = hash.substring(0, 8);
  if (npmVer) return `${npmVer} (${shortHash})`;
  return shortHash;
}
