/** Format an agent/user as "Title (name)" — falls back to just `name` when no title. */
export function formatAgentLabel(
  name: string,
  title: string | null | undefined,
): string {
  return title ? `${title} (${name})` : name;
}
