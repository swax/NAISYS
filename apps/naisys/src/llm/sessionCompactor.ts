import { AgentConfig } from "../agent/agentConfig.js";
import { DatabaseService } from "../services/dbService.js";
import { RunService } from "../services/runService.js";
import { OutputService } from "../utils/output.js";
import { ContextManager } from "./contextManager.js";
import { ContentSource, LlmRole } from "./llmDtos.js";
import { LLMService } from "./llmService.js";

export function createSessionCompactor(
  { agentConfig }: AgentConfig,
  contextManager: ContextManager,
  llmService: LLMService,
  output: OutputService,
) {
  let _lastSessionSummary = "";

  async function getLastSessionSummary(): Promise<string> {
    return _lastSessionSummary;
  }

  async function run(): Promise<string> {
    await output.commentAndLog("Compacting session...");

    _lastSessionSummary = await compact();

    return _lastSessionSummary;
  }

  async function compact(): Promise<string> {
    const systemMessage = `${agentConfig().agentPrompt}

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
        agentConfig().compactModel,
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
        "compact",
      )
    )[0];
  }

  return {
    getLastSessionSummary,
    run,
  };
}

export type SessionCompactor = ReturnType<typeof createSessionCompactor>;
