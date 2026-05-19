import {
  isAudioFilename,
  isImageFilename,
  mapWithConcurrency,
  mimeFromFilename,
} from "@naisys/common";
import type { RestoreData, ResumeEntry } from "@naisys/hub-protocol";
import stringArgv from "string-argv";

import type { AgentConfig } from "../../agent/agentConfig.js";
import {
  chatCmd,
  commentCmd,
  mailCmd,
  sessionCmd,
} from "../../command/commandDefs.js";
import type {
  CommandResponse,
  RegistrableCommand,
} from "../../command/commandRegistry.js";
import {
  NextCommandAction,
  noWait,
  timedWait,
} from "../../command/commandRegistry.js";
import type { ShellCommand } from "../../command/shellCommand.js";
import type { GlobalConfig } from "../../globalConfig.js";
import type { ContextManager } from "../../llm/contextManager.js";
import { ContentSource } from "../../llm/llmDtos.js";
import type { LLMService } from "../../llm/llmService.js";
import type { LogService } from "../../services/agent/logService.js";
import type { HubAttachmentClient } from "../../services/hub/hubAttachmentClient.js";
import type { InputModeService } from "../../utils/input/inputMode.js";
import type { OutputService } from "../../utils/output/output.js";
import { getTokenCount } from "../../utils/utilities.js";

/** Cap on concurrent hub attachment downloads during resume-replay so a
 *  long-running agent's image-heavy log doesn't open dozens of sockets. */
const RESUME_DOWNLOAD_CONCURRENCY = 4;

/** Optimal point to compact context. Waiting longer wastes money on bloated
 *  reads; compacting sooner wastes money generating summaries too often.
 *  Model min cacheable size agnostic. */
export const PREEMPTIVE_COMPACTION_THRESHOLD_TOKENS = 2400;

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  shellCommand: ShellCommand,
  output: OutputService,
  contextManager: ContextManager,
  systemMessage: string,
  llmService: LLMService,
  logService: LogService,
  hubAttachmentClient: HubAttachmentClient,
  inputMode: InputModeService,
  /** Resume bundle — hub already filtered by continuity + staleness. */
  preloadedRestore: RestoreData | undefined,
) {
  let restoreInfo = preloadedRestore?.summary ?? "";
  let resumeWaitSeconds: number | undefined;
  let pendingRestoreEntries: ResumeEntry[] | undefined =
    preloadedRestore?.entries;
  let restoreStale = preloadedRestore?.stale ?? false;
  const restoreCursor = preloadedRestore?.cursor;

  /** Gates `ns-session complete`: true iff the agent's last meaningful
   *  (non-wait) command was a successful chat-send or mail-send.
   *
   *  `complete` is a silent process exit — it produces no mail/chat
   *  event, so on its own it can't wake an offline lead. The gate
   *  forces a chat/mail send to immediately precede complete (waits
   *  in between are fine), guaranteeing the auto-start path
   *  (see docs/004) has an event to fire on. Without it, an agent
   *  could finish its work and exit while the lead stayed asleep with
   *  nothing to wake on — an effective hang. Waits preserve the flag;
   *  any other command clears it. See `updateCanComplete`. */
  let canComplete = false;

  if (restoreInfo) {
    output.commentAndLog(
      `Loaded restore summary from hub (${getTokenCount(restoreInfo)} tokens).`,
    );
  }

  function hasPendingRestoreEntries(): boolean {
    return !!pendingRestoreEntries && pendingRestoreEntries.length > 0;
  }

  /** Consume the resume bundle. `replayed`/`stale` flip atomically so a
   *  later iteration can't see stale=true after entries are gone.
   *  `stale=true` → retro-compact after replay. The tail normally carries
   *  the post-compact `ns-session restore` echo, so we scan for it and only
   *  prepend the summary as a defensive fallback when missing.
   *  Image/audio attachments rehydrate via appendImage/appendAudio,
   *  fetched in parallel up front. */
  async function replayRestoreEntries(): Promise<{
    replayed: boolean;
    stale: boolean;
  }> {
    if (!pendingRestoreEntries || pendingRestoreEntries.length === 0) {
      return { replayed: false, stale: false };
    }
    const entries = pendingRestoreEntries;
    const stale = restoreStale;
    pendingRestoreEntries = undefined;
    restoreStale = false;

    const cursorLabel = restoreCursor
      ? ` since run ${restoreCursor.runId} session ${restoreCursor.sessionId}`
      : "";
    output.commentAndLog(
      `Replaying ${entries.length} entries from previous context${cursorLabel}...`,
    );

    const silent = { skipLog: true };

    // Defensive fallback. The post-compact `ns-session restore` echo
    // normally carries the summary into context via the tail. Hitting
    // this branch means the echo wasn't logged — buffer dropped, hub
    // write failed, restore didn't run, or some other regression. Log
    // loudly so it gets noticed.
    if (
      restoreInfo &&
      !entries.some(
        (entry) => entry.source === "console" && entry.message === restoreInfo,
      )
    ) {
      output.errorAndLog(
        "Unexpected restore replay state: replayed entries did not include the compact summary; injecting fallback. This may indicate a restore logging bug.",
      );
      contextManager.append(
        `[Restored summary]\n${restoreInfo}`,
        ContentSource.Console,
        silent,
      );
    }

    const attachmentBuffers = await fetchAttachments(entries);

    for (const entry of entries) {
      const source = sourceFromString(entry.source);
      if (!source) continue;

      const buf = entry.attachment
        ? attachmentBuffers.get(entry.attachment.publicId)
        : undefined;

      if (entry.attachment && buf) {
        const { filename } = entry.attachment;
        const mime = mimeFromFilename(filename);
        const base64 = buf.toString("base64");
        if (isImageFilename(filename)) {
          // Falls through to text on a model-block reason (e.g. shellModel
          // changed since the prior run and no longer accepts image context).
          const blockReason = contextManager.appendImage(
            base64,
            mime,
            filename,
            silent,
          );
          if (blockReason) contextManager.append(entry.message, source, silent);
        } else if (isAudioFilename(filename)) {
          // Same fallback as images — guards against the agent recording audio
          // under a hearing-capable model and restarting under one that isn't.
          const blockReason = contextManager.appendAudio(
            base64,
            mime,
            filename,
            silent,
          );
          if (blockReason) contextManager.append(entry.message, source, silent);
        } else {
          // Hub already filters to image/audio; fall back to text just in case.
          contextManager.append(entry.message, source, silent);
        }
      } else {
        contextManager.append(entry.message, source, silent);
      }
    }
    return { replayed: true, stale };
  }

  /** Parallel-fetch (capped) all attachment bodies. Failures are swallowed
   *  so a missing/stale attachment doesn't abort the whole replay — the
   *  affected entry just falls back to its text message. */
  async function fetchAttachments(
    entries: ResumeEntry[],
  ): Promise<Map<string, Buffer>> {
    const ids = Array.from(
      new Set(
        entries
          .map((e) => e.attachment?.publicId)
          .filter((id): id is string => !!id),
      ),
    );
    if (ids.length === 0) return new Map();

    output.commentAndLog(`Fetching ${ids.length} attachments for replay...`);

    const results = await mapWithConcurrency(
      ids,
      RESUME_DOWNLOAD_CONCURRENCY,
      async (id) => {
        try {
          return [id, await hubAttachmentClient.downloadToBuffer(id)] as const;
        } catch (e) {
          output.errorAndLog(`Failed to fetch resume attachment ${id}: ${e}`);
          return [id, null] as const;
        }
      },
    );
    const map = new Map<string, Buffer>();
    for (const [id, buf] of results) {
      if (buf) map.set(id, buf);
    }
    return map;
  }

  /** Extracted from handleCompact so handleComplete can reuse the LLM call
   *  without triggering a session restart. */
  async function produceRestoreSummary(): Promise<void> {
    contextManager.append(
      "Process this session log and reduce it down to important things to remember - " +
        "references, plans, project structure, schemas, file locations, urls, and more. Focus on the near term, next logical steps. " +
        "Check for and fix any inconsistencies in the current context to avoid passing them on the next session. " +
        "The next session should be able to start with minimal bootstrapping or scanning of existing files. " +
        "What are the things the next session should do when restored - tasks, goals, etc.. And ensure it has " +
        "all the important context to do those things, as it will be starting from a blank slate. \n\n" +
        "# Write the restored-session seed below (no preamble).",
    );

    const queryResult = await llmService.query(
      agentConfig().shellModel,
      systemMessage,
      contextManager.getCombinedMessages(),
      "compact",
    );

    restoreInfo = queryResult.responses.join("\n");

    logService.write({
      role: "assistant",
      source: ContentSource.LLM,
      type: "compact",
      content: restoreInfo,
    });
  }

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);
    const subcommand = argv[0];

    if (!subcommand) {
      return getHelpText();
    }

    switch (subcommand) {
      case "help":
        return getHelpText();

      // Changed nomenclature from pause to wait to better reflect that the session can wake on events
      case "wait":
      case "continue-wait":
        return handleWait(argv[1]);

      case "compact":
        return handleCompact();

      case "preemptive-compact":
        return handlePreemptiveCompact(argv[1]);

      case "restore":
        return handleRestore();

      case "complete":
        return handleComplete();

      case "clear":
        return handleClear();

      default:
        return `Unknown subcommand: ${subcommand}\n\n${getHelpText()}`;
    }
  }

  function getHelpText(): string {
    const subs = sessionCmd.subcommands!;

    let helpText = `${sessionCmd.name} <subcommand>
  ${subs.wait.usage.padEnd(20)}${subs.wait.description}`;

    if (globalConfig().compactSessionEnabled) {
      helpText += `
  ${subs.compact.usage.padEnd(20)}${subs.compact.description}`;
    }

    if (agentConfig().completeSessionEnabled) {
      helpText += `
  ${subs.complete.usage.padEnd(20)}${subs.complete.description}`;
    }

    if (inputMode.isDebug()) {
      helpText += `
  ${subs.clear.usage.padEnd(20)}${subs.clear.description}`;
    }

    return helpText;
  }

  function handleWait(
    secondsArg: string | undefined,
  ): string | CommandResponse {
    const waitSeconds = secondsArg ? parseInt(secondsArg) : NaN;

    // Indefinite waits are kept internal so unattended agents do not hang the system.
    if (isNaN(waitSeconds) || waitSeconds <= 0) {
      return `Please specify the number of seconds to wait, for example: ns-session wait 60`;
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        wait: timedWait(waitSeconds),
      },
    };
  }

  async function handleCompact(): Promise<string | CommandResponse> {
    if (!globalConfig().compactSessionEnabled) {
      return 'The "ns-session compact" command is not enabled in this environment.';
    }

    if (shellCommand.isShellSuspended()) {
      return "Session cannot be compacted while a shell command is active.";
    }

    output.commentAndLog(`Compacting...`);

    await produceRestoreSummary();

    output.commentAndLog(
      `Session compacted to ${getTokenCount(restoreInfo)} tokens. Restarting Session.`,
    );
    output.commentAndLog(
      "------------------------------------------------------",
    );

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.CompactSession,
        wait: noWait(),
      },
    };
  }

  async function handlePreemptiveCompact(
    remainingSecondsArg: string | undefined,
  ): Promise<string | CommandResponse> {
    if (!globalConfig().preemptiveCompactEnabled) {
      throw new Error("Preemptive compact is not enabled");
    }

    if (!agentConfig().autoCompact) {
      throw new Error("Auto compact is not enabled for this agent");
    }

    const remaining = remainingSecondsArg ? parseInt(remainingSecondsArg) : 0;
    if (isNaN(remaining) || remaining < 0) {
      throw new Error(
        "Preemptive compact requires a valid remaining seconds argument",
      );
    }

    if (remaining > 0) {
      output.commentAndLog(
        `Pre-emptively compacting session before read cache expires. Will continue waiting ${remaining} seconds on resume...`,
      );
      resumeWaitSeconds = remaining;
    } else {
      output.commentAndLog(
        `Pre-emptively compacting session before read cache expires...`,
      );
    }
    return handleCompact();
  }

  function handleRestore(): string | CommandResponse {
    if (!restoreInfo) {
      return "No session restore information available.";
    }

    return {
      content: restoreInfo,
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
      },
    };
  }

  /** Like compact but no LLM call — writes a `type: "compact"` row whose
   *  text is shown to the next session as its restored summary. The rest
   *  flows through compact's normal path: hub mirror advances
   *  `compact_log_id`, the restart queues `ns-session restore`, the echo
   *  lands in the tail. Hidden from non-debug help but callable by the
   *  agent if asked. */
  function handleClear(): string | CommandResponse {
    const clearMessage = "Previous Session Cleared";

    logService.write({
      role: "assistant",
      source: ContentSource.LLM,
      type: "compact",
      content: clearMessage,
    });

    // Non-empty so getResumeCommands queues `ns-session restore` on the
    // restart and the echo logs into the tail — otherwise next
    // AGENT_START's scan misses the echo and trips the defensive fallback.
    restoreInfo = clearMessage;

    output.commentAndLog(
      "Session Cleared — restarting with no context history or summary.",
    );
    output.commentAndLog(
      "------------------------------------------------------",
    );

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.CompactSession,
        wait: noWait(),
      },
    };
  }

  async function handleComplete(): Promise<string | CommandResponse> {
    if (!agentConfig().completeSessionEnabled) {
      return 'The "ns-session complete" command is not enabled for you, please use wait command instead.';
    }

    // The send is what wakes an offline recipient via auto-start; complete
    // itself is silent. See the `canComplete` doc above for the full why.
    if (!canComplete) {
      return `Report results to your lead, admin, or someone else via chat or mail before calling complete.`;
    }

    // Capture a fresh seed before exit so the next run can resume. Skip
    // the LLM call when context is small — next session's RestoreData
    // replays the raw entries fine at this size. Symmetric to the
    // retro-compact skip in commandLoop.runSessionStartup.
    if (agentConfig().continuity === "summary") {
      if (
        contextManager.getTokenCount() < PREEMPTIVE_COMPACTION_THRESHOLD_TOKENS
      ) {
        output.commentAndLog(
          "Context below compact threshold, skipping summary.",
        );
      } else {
        output.commentAndLog("Saving session summary before completing...");
        try {
          await produceRestoreSummary();
        } catch (e) {
          output.errorAndLog(`Failed to produce restore summary: ${e}`);
        }
      }
    }

    output.commentAndLog("Session completed. Exiting process.");

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.SessionComplete,
        wait: noWait(),
      },
    };
  }

  const registrableCommand: RegistrableCommand = {
    command: sessionCmd,
    handleCommand,
  };

  function getResumeCommands(): string[] {
    const commands: string[] = [];

    if (restoreInfo) {
      commands.push("ns-session restore");
    }

    if (resumeWaitSeconds && resumeWaitSeconds > 0) {
      commands.push(`ns-session continue-wait ${resumeWaitSeconds}`);
      resumeWaitSeconds = undefined;
    }

    return commands;
  }

  /** Called by the command handler after each successful dispatch to
   *  maintain the `canComplete` gate. Waits and ns-comment preserve the
   *  flag so `chat send → wait → complete` or `chat send → ns-comment →
   *  complete` is allowed; any other command clears it. */
  function updateCanComplete(commandName: string, cmdArgs: string): void {
    const sub = stringArgv(cmdArgs)[0];

    if (commandName === sessionCmd.name) {
      // wait/continue-wait preserve the flag; complete is a read, not a
      // write; other ns-session subs (compact, restore, clear) are real
      // commands and should invalidate the prior chat/mail.
      if (sub === "wait" || sub === "continue-wait" || sub === "complete") {
        return;
      }
      canComplete = false;
      return;
    }

    // ns-comment is thinking-out-loud, not a real action — preserve the
    // gate so the agent can narrate between a send and complete.
    if (commandName === commentCmd.name) {
      return;
    }

    if (
      (commandName === chatCmd.name || commandName === mailCmd.name) &&
      sub === "send"
    ) {
      canComplete = true;
      return;
    }

    canComplete = false;
  }

  return {
    ...registrableCommand,
    getResumeCommands,
    replayRestoreEntries,
    hasPendingRestoreEntries,
    updateCanComplete,
  };
}

/** Prompt-boundary markers (startPrompt/endPrompt) coerce to their content
 *  role so the replay keeps the user/assistant text they carry. */
function sourceFromString(s: string): ContentSource | undefined {
  switch (s) {
    case "console":
    case "startPrompt":
      return ContentSource.Console;
    case "llm":
    case "endPrompt":
      return ContentSource.LLM;
    default:
      return undefined;
  }
}

export type SessionService = ReturnType<typeof createSessionService>;
