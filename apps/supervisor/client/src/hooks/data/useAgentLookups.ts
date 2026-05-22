import { useMemo } from "react";

import { useAgentDataContext } from "../../contexts/AgentDataContext";

/**
 * Maps from user id to display name and title, derived from the agent roster —
 * for resolving the numeric ids carried in socket events back to something
 * renderable.
 */
export function useAgentLookups() {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const titleLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.title])),
    [agents],
  );
  return { userLookup, titleLookup };
}
