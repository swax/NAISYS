import { monotonicFactory } from "@naisys/database";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { DatabaseService } from "@naisys/database";
import { RunService } from "./runService.js";

export function createLogService(
  { usingDatabase }: DatabaseService,
  runService: RunService,
) {
  // Use monotonic ULID to preserve strict ordering within a session
  const monotonicUlid = monotonicFactory();

  async function write(message: LlmMessage) {
    const { getUserId, getRunId, getSessionId } = runService;

    const insertedId = await usingDatabase(async (prisma) => {
      const inserted = await prisma.context_log.create({
        data: {
          id: monotonicUlid(),
          user_id: getUserId(),
          run_id: getRunId(),
          session_id: getSessionId(),
          role: toSimpleRole(message.role),
          source: message.source?.toString() || "",
          type: message.type || "",
          message: message.content,
          created_at: new Date().toISOString(),
        },
      });

      const now = new Date().toISOString();

      // Update session table with total lines and last active
      await prisma.run_session.updateMany({
        where: {
          user_id: getUserId(),
          run_id: getRunId(),
          session_id: getSessionId(),
        },
        data: {
          last_active: now,
          latest_log_id: inserted.id,
          total_lines: {
            increment: message.content.split("\n").length,
          },
        },
      });

      // Also update user_notifications with latest_log_id and last_active
      await prisma.user_notifications.updateMany({
        where: {
          user_id: getUserId(),
        },
        data: {
          latest_log_id: inserted.id,
          last_active: now,
        },
      });

      return inserted.id;
    });

    return insertedId;
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
    toSimpleRole,
  };
}

export type LogService = Awaited<ReturnType<typeof createLogService>>;
