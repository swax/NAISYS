import { useEffect, useRef } from "react";
import type { AgentStatusEvent } from "@naisys-supervisor/shared";
import { SSE_STREAM_URL } from "../lib/apiClient";

/**
 * Opens an EventSource to /status/stream and calls onUpdate with parsed
 * AgentStatusEvent data whenever a message arrives.
 *
 * @param onUpdate - callback invoked with each SSE event payload
 * @param enabled - gate connection (e.g. wait for initial REST load)
 */
export function useAgentStatusStream(
  onUpdate: (event: AgentStatusEvent) => void,
  enabled: boolean,
) {
  // Use a ref so the EventSource callback always sees the latest onUpdate
  // without re-creating the connection when the callback identity changes.
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource(SSE_STREAM_URL, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentStatusEvent;
        callbackRef.current(data);
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      eventSource.close();
    };
  }, [enabled]);
}
