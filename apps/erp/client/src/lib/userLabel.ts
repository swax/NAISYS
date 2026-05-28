/** Format a user as "Title (username)" — falls back to just `username` when no title. */
export function formatUserLabel(
  username: string,
  title: string | null | undefined,
): string {
  return title ? `${title} (${username})` : username;
}
