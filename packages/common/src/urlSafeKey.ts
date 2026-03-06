/** Characters allowed in URL path segments used as database keys (usernames, hostnames). */
export const URL_SAFE_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;

export const URL_SAFE_KEY_MESSAGE =
  "Must contain only letters, numbers, hyphens, and underscores";

/** Sanitize a string into a URL-safe key (replace spaces/special chars with hyphens). */
export function toUrlSafeKey(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Throws if the value is not a valid URL-safe key. */
export function assertUrlSafeKey(value: string, label: string): void {
  if (!URL_SAFE_KEY_REGEX.test(value)) {
    throw new Error(
      `${label} "${value}" is not URL-safe. ${URL_SAFE_KEY_MESSAGE}`,
    );
  }
}
