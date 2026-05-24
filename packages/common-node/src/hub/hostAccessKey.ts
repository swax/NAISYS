/**
 * Resolve the host access key from the HOST_ACCESS_KEY environment variable.
 * Returns undefined when unset. Integrated-mode processes populate
 * `process.env.HOST_ACCESS_KEY` themselves during host bootstrap, so callers
 * never need to read a fallback file.
 */
export function resolveHostAccessKey(): string | undefined {
  return process.env.HOST_ACCESS_KEY;
}
