import { AgentConfig } from "../agentConfig.js";
import { DatabaseService } from "../services/dbService.js";
import { RunService } from "../services/runService.js";
import { OutputService } from "../utils/output.js";
import { ContextManager } from "./contextManager.js";
import { ContentSource, LlmRole } from "./llmDtos.js";
import { LLMService } from "./llmService.js";

export function createDreamMaker(
  agentConfig: AgentConfig,
  contextManager: ContextManager,
  llmService: LLMService,
  { usingDatabase }: DatabaseService,
  runService: RunService,
  output: OutputService,
) {
  let _lastDream = "";

  async function goodmorning(): Promise<string> {
    if (!agentConfig.persistAcrossRuns) {
      return _lastDream;
    }

    const userId = runService.getUserId();

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
    await output.commentAndLog("Wrapping up the session...");

    const dream = await runDreamSequence();

    if (agentConfig.persistAcrossRuns) {
      await storeDream(dream);
    } else {
      _lastDream = dream;
    }

    return dream;
  }

  async function runDreamSequence(): Promise<string> {
    const systemMessage = `${agentConfig.agentPrompt}

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
        agentConfig.dreamModel,
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
    const { getUserId, getRunId, getSessionId } = runService;

    await usingDatabase(async (prisma) => {
      await prisma.dream_log.create({
        data: {
          user_id: getUserId(),
          run_id: getRunId(),
          session_id: getSessionId(),
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
