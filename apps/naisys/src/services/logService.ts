import { HubLogBuffer } from "../hub/hubLogBuffer.js";
import { getTextContent, LlmMessage, type LlmRole } from "../llm/llmDtos.js";
import { AttachmentService } from "./attachmentService.js";
import { RunService } from "./runService.js";

export function createLogService(
  hubLogBuffer: HubLogBuffer | undefined,
  runService: RunService,
  localUserId: number,
  attachmentService: AttachmentService | undefined,
) {
  function write(message: LlmMessage, filepath?: string) {
    if (!hubLogBuffer) return;

    const { getRunId, getSessionId } = runService;

    const entry = {
      userId: localUserId,
      runId: getRunId(),
      sessionId: getSessionId(),
      role: toSimpleRole(message.role),
      source: message.source ?? null,
      type: message.type ?? null,
      message: message.logMessage ?? getTextContent(message.content),
      createdAt: new Date().toISOString(),
    };

    const resolveAttachment =
      filepath && attachmentService
        ? () => attachmentService.upload(filepath, "context")
        : undefined;

    hubLogBuffer.pushEntry(entry, resolveAttachment);
  }

  function toSimpleRole(role: LlmRole): "LLM" | "NAISYS" {
    switch (role) {
      case "assistant":
        return "LLM";
      case "user":
        return "NAISYS";
      case "system":
        return "NAISYS";
    }
  }

  return {
    write,
  };
}

export type LogService = ReturnType<typeof createLogService>;
