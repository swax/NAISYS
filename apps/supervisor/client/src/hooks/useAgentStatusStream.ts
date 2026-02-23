import type { AgentStatusEvent } from "@naisys-supervisor/shared";
import { useEffect, useRef } from "react";

import { SSE_STREAM_URL } from "../lib/apiClient";

// Shared singleton EventSource so multiple hooks can subscribe without
// opening duplicate SSE connections.
type Listener = (event: AgentStatusEvent) => void;
const listeners = new Set<Listener>();
let sharedEventSource: EventSource | null = null;

function ensureConnection() {
  if (sharedEventSource) return;

  const es = new EventSource(SSE_STREAM_URL, { withCredentials: true });

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as AgentStatusEvent;
      for (const listener of listeners) {
        listener(data);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  sharedEventSource = es;
}

function closeIfUnused() {
  if (listeners.size === 0 && sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
}

/**
 * Opens a shared EventSource to /status/stream and calls onUpdate with parsed
 * AgentStatusEvent data whenever a message arrives.
 *
 * Multiple hook instances share a single SSE connection.
 *
 * @param onUpdate - callback invoked with each SSE event payload
 * @param enabled - gate connection (e.g. wait for initial REST load)
 */
export function useAgentStatusStream(
  onUpdate: (event: AgentStatusEvent) => void,
  enabled: boolean,
) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    if (!enabled) return;

    const listener: Listener = (event) => callbackRef.current(event);
    listeners.add(listener);
    ensureConnection();

    return () => {
      listeners.delete(listener);
      closeIfUnused();
    };
  }, [enabled]);
}
