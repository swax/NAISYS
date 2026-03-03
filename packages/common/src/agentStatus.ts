export type AgentStatus = "active" | "available" | "offline" | "suspended";

export function determineAgentStatus(opts: {
  isActive: boolean;
  isSuspended: boolean;
  assignedHostIds: number[] | undefined;
  isHostOnline: (hostId: number) => boolean;
  hasNonRestrictedOnlineHost: boolean;
}): AgentStatus {
  // Priority: offline > suspended > active > available
  const isOffline = opts.assignedHostIds?.length
    ? !opts.assignedHostIds.some(opts.isHostOnline)
    : !opts.hasNonRestrictedOnlineHost;

  if (isOffline) return "offline";
  if (opts.isSuspended) return "suspended";
  if (opts.isActive) return "active";
  return "available";
}
