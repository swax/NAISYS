import {
  HubEvents,
  LOG_FLUSH_INTERVAL_MS,
  LogWriteEntry,
} from "@naisys/hub-protocol";
import { HubClient } from "../hub/hubClient.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { RunService } from "./runService.js";

export function createLogService(
  hubClient: HubClient | undefined,
  runService: RunService,
  localUserId: number,
) {
  // In-memory buffer for hub mode
  const buffer: LogWriteEntry[] = [];

  // Start flush interval in hub mode
  let flushInterval: NodeJS.Timeout | null = null;
  if (hubClient) {
    flushInterval = setInterval(flush, LOG_FLUSH_INTERVAL_MS);
  }

  function write(message: LlmMessage) {
    const { getRunId, getSessionId } = runService;

    if (hubClient) {
      buffer.push({
        userId: localUserId,
        runId: getRunId(),
        sessionId: getSessionId(),
        role: toSimpleRole(message.role),
        source: message.source?.toString() || "",
        type: message.type || "",
        message: message.content,
        createdAt: new Date().toISOString(),
      });
    }
  }

  function flush() {
    if (!hubClient) return;
    if (buffer.length === 0) return;

    const entries = buffer.splice(0, buffer.length);
    hubClient.sendMessage(HubEvents.LOG_WRITE, { entries });
  }

  function cleanup() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    // Final flush
    if (hubClient) {
      flush();
    }
  }

  function toSimpleRole(role: LlmRole) {
    switch (role) {
      case LlmRole.Assistant:
        return "LLM";
      case LlmRole.User:
        return "NAISYS";
      case LlmRole.System:
        return "NAISYS";
    }
  }

  return {
    write,
    cleanup,
  };
}

export type LogService = ReturnType<typeof createLogService>;
