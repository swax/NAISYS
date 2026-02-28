export type AgentStatus = "active" | "available" | "offline";

export function determineAgentStatus(opts: {
  isActive: boolean;
  assignedHostIds: number[] | undefined;
  isHostOnline: (hostId: number) => boolean;
  hasNonRestrictedOnlineHost: boolean;
}): AgentStatus {
  if (opts.isActive) return "active";

  if (!opts.assignedHostIds || opts.assignedHostIds.length === 0) {
    return opts.hasNonRestrictedOnlineHost ? "available" : "offline";
  }

  return opts.assignedHostIds.some(opts.isHostOnline) ? "available" : "offline";
}
