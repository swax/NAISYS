import type { Agent } from "../types/agent";

/**
 * Build the list of agents to surface as "start a chat/message with"
 * candidates in conversation sidebars. Skips archived agents, the current
 * agent, and any names in `excludeNames` (typically existing 1:1 partners).
 *
 * Sorted by depth in the lead chain (roots first, then 1 level down, …),
 * with ties broken alphabetically.
 */
export function buildAgentCandidates({
  agents,
  currentAgentName,
  excludeNames,
}: {
  agents: Agent[];
  currentAgentName: string;
  excludeNames?: ReadonlySet<string>;
}): Agent[] {
  if (!currentAgentName) return [];

  const byName = new Map(agents.map((a) => [a.name, a]));

  const computeLevel = (agent: Agent): number => {
    let level = 0;
    let cur: Agent | undefined = agent;
    const seen = new Set<string>();
    while (cur?.leadUsername) {
      if (seen.has(cur.name)) break;
      seen.add(cur.name);
      const lead = byName.get(cur.leadUsername);
      if (!lead) break;
      level++;
      cur = lead;
    }
    return level;
  };

  return agents
    .filter(
      (a) =>
        !a.archived &&
        a.name !== currentAgentName &&
        !excludeNames?.has(a.name),
    )
    .map((a) => ({ agent: a, level: computeLevel(a) }))
    .sort(
      (a, b) => a.level - b.level || a.agent.name.localeCompare(b.agent.name),
    )
    .map(({ agent }) => agent);
}
