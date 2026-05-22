/** Compact formatting helpers shared across the dashboard panels. */

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "just now", "2m ago", "5h ago" — for a past timestamp. */
export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 30_000) return "just now";
  return `${formatDuration(diffMs)} ago`;
}

/** "now", "in 12m", "in 2h" — for a future timestamp. */
export function formatUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "now";
  return `in ${formatDuration(diffMs)}`;
}

/** The participants of a conversation other than `exclude` (the sender). */
export function participantsExcept(
  participants: string,
  exclude: string,
): string {
  const others = participants
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== exclude);
  return others.length > 0 ? others.join(", ") : "—";
}
