import {
  HubEvents,
  LOG_FLUSH_INTERVAL_MS,
  LogWriteEntry,
} from "@naisys/hub-protocol";

import { HubClient } from "../hub/hubClient.js";
import { getTextContent, LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { AttachmentService } from "./attachmentService.js";
import { RunService } from "./runService.js";

/** Internal buffer entry that may carry a filepath for hub upload */
interface BufferedLogEntry {
  entry: LogWriteEntry;
  filepath?: string;
}

export function createLogService(
  hubClient: HubClient | undefined,
  runService: RunService,
  localUserId: number,
  attachmentService: AttachmentService | undefined,
) {
  // In-memory buffer for hub mode
  const buffer: BufferedLogEntry[] = [];

  // Guard against overlapping flushes
  let flushing = false;

  // Start flush interval in hub mode
  let flushInterval: NodeJS.Timeout | null = null;
  if (hubClient) {
    flushInterval = setInterval(() => void flush(), LOG_FLUSH_INTERVAL_MS);
  }

  function write(message: LlmMessage, filepath?: string) {
    const { getRunId, getSessionId } = runService;

    if (hubClient) {
      buffer.push({
        entry: {
          userId: localUserId,
          runId: getRunId(),
          sessionId: getSessionId(),
          role: toSimpleRole(message.role),
          source: message.source?.toString() || "",
          type: message.type || "",
          message: getTextContent(message.content),
          createdAt: new Date().toISOString(),
        },
        filepath,
      });
    }
  }

  async function flush() {
    if (!hubClient) return;
    if (buffer.length === 0) return;
    if (flushing) return;

    flushing = true;
    try {
      const items = buffer.splice(0, buffer.length);

      // Upload any attachment files before sending entries
      if (attachmentService) {
        for (const item of items) {
          if (item.filepath) {
            try {
              item.entry.attachmentId = await attachmentService.upload(
                item.filepath,
                "context",
              );
            } catch {
              // Upload failed — log entry will be sent without attachment
            }
          }
        }
      }

      const entries = items.map((item) => item.entry);
      hubClient.sendMessage(HubEvents.LOG_WRITE, { entries });
    } finally {
      flushing = false;
    }
  }

  async function cleanup() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    // Final flush
    if (hubClient) {
      await flush();
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
