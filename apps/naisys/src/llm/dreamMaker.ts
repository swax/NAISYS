import { Config } from "../config.js";
import { DatabaseService } from "../services/dbService.js";
import { OutputService } from "../utils/output.js";
import { ContextManager } from "./contextManager.js";
import { ContentSource, LlmRole } from "./llmDtos.js";
import { LLMService } from "./llmService.js";

export function createDreamMaker(
  config: Config,
  contextManager: ContextManager,
  llmService: LLMService,
  { usingDatabase }: DatabaseService,
  output: OutputService,
) {
  let _lastDream = "";

  async function goodmorning(): Promise<string> {
    if (!config.agent.persistAcrossRuns) {
      return _lastDream;
    }

    const { userId } = config.getUserRunSession();

    return await usingDatabase(async (prisma) => {
      const row = await prisma.dream_log.findFirst({
        where: { user_id: userId },
        orderBy: { date: "desc" },
        select: { dream: true },
      });

      return row?.dream || "";
    });
  }

  async function goodnight(): Promise<string> {
    output.commentAndLog("Wrapping up the session...");

    const dream = await runDreamSequence();

    if (config.agent.persistAcrossRuns) {
      await storeDream(dream);
    } else {
      _lastDream = dream;
    }

    return dream;
  }

  async function runDreamSequence(): Promise<string> {
    const systemMessage = `${config.agent.agentPrompt}

Below is the console log from this session. Please process this log and 
reduce it down to important things to remember - references, plans, project structure, schemas, 
file locations, urls, and more. You don't need to summarize what happened, or plan what to do in the far future, just focus on the
near term. Check the console log for inconsistencies, things to fix and/or check. Using this information the
next session should be able to start with minimal scanning of existing files to figure out what to do 
and how to do it.`;

    const combinedContextLog = contextManager
      .getCombinedMessages()
      .map((m) => {
        const suffix = m.source == ContentSource.ConsolePrompt ? "" : "\n";
        return m.content + suffix;
      })
      .join("");

    return (
      await llmService.query(
        config.agent.dreamModel,
        systemMessage,
        [
          {
            role: LlmRole.User,
            content: combinedContextLog,
          },
          {
            role: LlmRole.Assistant,
            content:
              "Console log processed so that the next session can start with minimal scanning of existing files.",
          },
          {
            role: LlmRole.User,
            content: `Please show the results of the processing.`,
          },
        ],
        "dream",
      )
    )[0];
  }

  async function storeDream(dream: string) {
    const { userId, runId, sessionId } = config.getUserRunSession();

    await usingDatabase(async (prisma) => {
      await prisma.dream_log.create({
        data: {
          user_id: userId,
          run_id: runId,
          session_id: sessionId,
          date: new Date().toISOString(),
          dream,
        },
      });
    });
  }

  return {
    goodmorning,
    goodnight,
  };
}

export type DreamMaker = ReturnType<typeof createDreamMaker>;
