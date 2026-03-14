export type AgentStatus =
  | "active"
  | "available"
  | "disabled"
  | "offline"
  | "suspended";

export function determineAgentStatus(opts: {
  isActive: boolean;
  isEnabled: boolean;
  isSuspended: boolean;
  assignedHostIds: number[] | undefined;
  isHostOnline: (hostId: number) => boolean;
  hasNonRestrictedOnlineHost: boolean;
}): AgentStatus {
  // Priority: disabled > offline > suspended > active > available
  if (!opts.isEnabled) return "disabled";

  const isOffline = opts.assignedHostIds?.length
    ? !opts.assignedHostIds.some(opts.isHostOnline)
    : !opts.hasNonRestrictedOnlineHost;

  if (isOffline) return "offline";
  if (opts.isSuspended) return "suspended";
  if (opts.isActive) return "active";
  return "available";
}
