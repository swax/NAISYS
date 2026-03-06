import type { AgentStatusEvent } from "@naisys-supervisor/shared";

import { useSubscription } from "./useSubscription";

/**
 * Subscribe to agent status updates via WebSocket.
 *
 * @param onUpdate - callback invoked with each status event payload
 * @param enabled - gate subscription (e.g. wait for initial REST load)
 */
export function useAgentStatusStream(
  onUpdate: (event: AgentStatusEvent) => void,
  enabled: boolean,
) {
  useSubscription<AgentStatusEvent>(enabled ? "status" : null, onUpdate);
}
