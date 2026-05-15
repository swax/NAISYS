/**
 * Convert the database subagent id representation into the protocol/API shape.
 *
 * The database uses 0 as a non-null sentinel for parent-agent activity because
 * subagent_id participates in composite keys. On the wire, parent-agent
 * activity omits subagentId; negative ids identify ephemeral subagents.
 */
export function dbSubagentIdToWire(
  subagentId: number | null | undefined,
): number | undefined {
  return subagentId === 0 || subagentId == null ? undefined : subagentId;
}
