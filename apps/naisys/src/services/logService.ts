import { Config } from "../config.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { DatabaseService } from "./dbService.js";

export function createLogService(
  config: Config,
  { usingDatabase }: DatabaseService,
) {
  async function write(message: LlmMessage) {
    const { userId, runId, sessionId } = config.getUserRunSession();

    const insertedId = await usingDatabase(async (prisma) => {
      const inserted = await prisma.context_log.create({
        data: {
          user_id: userId,
          run_id: runId,
          session_id: sessionId,
          role: toSimpleRole(message.role),
          source: message.source?.toString() || "",
          type: message.type || "",
          message: message.content,
          date: new Date().toISOString(),
        },
      });

      // Update session table with total lines and last active
      await prisma.run_session.updateMany({
        where: {
          user_id: userId,
          run_id: runId,
          session_id: sessionId,
        },
        data: {
          last_active: new Date().toISOString(),
          latest_log_id: inserted.id,
          total_lines: {
            increment: message.content.split("\n").length,
          },
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
