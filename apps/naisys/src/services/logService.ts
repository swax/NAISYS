import {
  HubEvents,
  LOG_FLUSH_INTERVAL_MS,
  LogWriteEntry,
} from "@naisys/hub-protocol";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { RunService } from "./runService.js";

export function createLogService(
  globalConfig: GlobalConfig,
  hubClient: HubClient,
  runService: RunService,
  localUserId: string,
) {
  const isHubMode = globalConfig.globalConfig().isHubMode;

  // In-memory buffer for hub mode
  const buffer: LogWriteEntry[] = [];

  // Start flush interval in hub mode
  let flushInterval: NodeJS.Timeout | null = null;
  if (isHubMode) {
    flushInterval = setInterval(flush, LOG_FLUSH_INTERVAL_MS);
  }

  function write(message: LlmMessage) {
    const { getRunId, getSessionId } = runService;

    if (isHubMode) {
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
    if (isHubMode) {
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
