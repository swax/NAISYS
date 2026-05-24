import type { AgentStatus } from "@naisys/common";

const STATUS_COLOR_NAME: Record<AgentStatus, string> = {
  active: "green",
  available: "blue",
  paused: "yellow",
  suspended: "red",
  disabled: "dark",
  offline: "gray",
};

/** Mantine color name (no shade), e.g. "green". For Badge `color` props. */
export function getAgentStatusColor(status: AgentStatus | undefined): string {
  return (status && STATUS_COLOR_NAME[status]) ?? "gray";
}

/** Filled-dot color, e.g. "green.6"; literal "black" for disabled. */
export function getAgentStatusDotColor(
  status: AgentStatus | undefined,
): string {
  if (status === "disabled") return "black";
  return `${getAgentStatusColor(status)}.6`;
}

/** CSS color string for inline `style` props, e.g. "var(--mantine-color-green-6)". */
export function getAgentStatusCssColor(
  status: AgentStatus | undefined,
): string {
  const dot = getAgentStatusDotColor(status);
  if (!dot.includes(".")) return dot;
  const [name, shade] = dot.split(".");
  return `var(--mantine-color-${name}-${shade})`;
}
