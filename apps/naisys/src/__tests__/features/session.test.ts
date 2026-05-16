import { LlmApiType, type LlmModel } from "@naisys/common";
import type { RestoreData } from "@naisys/hub-protocol";
import { describe, expect, test, vi } from "vitest";

import type { AgentConfig } from "../../agent/agentConfig.js";
import { NextCommandAction } from "../../command/commandRegistry.js";
import { createSessionService } from "../../features/shell/session.js";
import type { HubLogBuffer } from "../../hub/hubLogBuffer.js";
import { createContextManager } from "../../llm/contextManager.js";
import type { LLMService } from "../../llm/llmService.js";
import type { AttachmentService } from "../../services/agent/attachmentService.js";
import { createLogService } from "../../services/agent/logService.js";
import type { ModelService } from "../../services/agent/modelService.js";
import type { RunService } from "../../services/agent/runService.js";
import type { HubAttachmentClient } from "../../services/hub/hubAttachmentClient.js";
import {
  createMockAgentConfig,
  createMockGlobalConfig,
  createMockInputMode,
  createMockOutputService,
  createMockShellCommand,
  createMockWorkspacesFeature,
} from "../mocks.js";

const baseModel: LlmModel = {
  key: "test-model",
  label: "Test Model",
  versionName: "test-model",
  apiType: LlmApiType.Mock,
  maxTokens: 100_000,
  apiKeyVar: "",
  inputCost: 0,
  outputCost: 0,
  supportsVision: true,
  supportsHearing: true,
};

function buildRestoreHarness(
  restoreData: RestoreData,
  opts: {
    model?: LlmModel;
    controlDesktop?: boolean;
    buffers?: Record<string, Buffer>;
  } = {},
) {
  const globalConfig = createMockGlobalConfig();
  const baseAgentConfig = createMockAgentConfig();
  const agentConfig = {
    ...baseAgentConfig,
    agentConfig: () => ({
      ...baseAgentConfig.agentConfig(),
      shellModel: "test-model",
      controlDesktop: opts.controlDesktop ?? false,
    }),
  } as AgentConfig;

  const pushEntry = vi.fn();
  const hubLogBuffer = {
    pushEntry,
    flushFinal: vi.fn(() => Promise.resolve()),
  } as unknown as HubLogBuffer;
  const upload = vi.fn();
  const attachmentService = {
    upload,
    uploadAll: vi.fn(),
  } as unknown as AttachmentService;
  const runService = {
    getRunId: vi.fn(() => 12),
    getSessionId: vi.fn(() => 3),
    incrementSession: vi.fn(() => Promise.resolve()),
  } as unknown as RunService;
  const logService = createLogService(
    hubLogBuffer,
    runService,
    42,
    attachmentService,
  );

  const inputMode = createMockInputMode();
  inputMode.isDebug.mockReturnValue(false);
  inputMode.isLLM.mockReturnValue(true);
  const output = createMockOutputService();
  const modelService = {
    getLlmModel: vi.fn(() => opts.model ?? baseModel),
    getImageModel: vi.fn(),
    waitForModels: vi.fn(() => Promise.resolve()),
  } as unknown as ModelService;
  const contextManager = createContextManager(
    agentConfig,
    modelService,
    createMockWorkspacesFeature(),
    "system message",
    output,
    logService,
    inputMode,
  );

  const buffers = opts.buffers ?? {};
  const hubAttachmentClient = {
    downloadToBuffer: vi.fn((publicId: string) =>
      Promise.resolve(buffers[publicId] ?? Buffer.from(publicId)),
    ),
    downloadToFile: vi.fn(),
    sweepStaleTmpFiles: vi.fn(),
  } as unknown as HubAttachmentClient;

  const sessionService = createSessionService(
    globalConfig,
    agentConfig,
    createMockShellCommand(),
    output,
    contextManager,
    "system message",
    { query: vi.fn() } as unknown as LLMService,
    logService,
    hubAttachmentClient,
    inputMode,
    restoreData,
  );

  return {
    contextManager,
    hubAttachmentClient,
    output,
    pushEntry,
    sessionService,
    upload,
  };
}

describe("session restore replay", () => {
  test("replays media entries with existing attachment ids so future full restores retain media", async () => {
    const imageBytes = Buffer.from("image-bytes");
    const audioBytes = Buffer.from("audio-bytes");
    const {
      contextManager,
      hubAttachmentClient,
      pushEntry,
      sessionService,
      upload,
    } = buildRestoreHarness(
      {
        entries: [
          {
            source: "console",
            message: "[Image: screen.png]",
            attachment: {
              publicId: "img-public",
              filename: "screen.png",
            },
          },
          {
            source: "console",
            message: "[Audio: voice.mp3]",
            attachment: {
              publicId: "audio-public",
              filename: "voice.mp3",
            },
          },
        ],
      },
      {
        buffers: {
          "img-public": imageBytes,
          "audio-public": audioBytes,
        },
      },
    );

    expect(sessionService.hasPendingRestoreEntries()).toBe(true);
    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: true,
      stale: false,
    });
    expect(sessionService.hasPendingRestoreEntries()).toBe(false);

    expect(hubAttachmentClient.downloadToBuffer).toHaveBeenCalledWith(
      "img-public",
    );
    expect(hubAttachmentClient.downloadToBuffer).toHaveBeenCalledWith(
      "audio-public",
    );
    expect(upload).not.toHaveBeenCalled();

    const messages = contextManager.exportedForTesting.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toMatchObject([
      { type: "text", text: "[Image: screen.png]" },
      {
        type: "image",
        base64: imageBytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(messages[1].content).toMatchObject([
      { type: "text", text: "[Audio: voice.mp3]" },
      {
        type: "audio",
        base64: audioBytes.toString("base64"),
        mimeType: "audio/mpeg",
      },
    ]);

    // Silent replay — log entries should not be re-written for replayed content.
    expect(pushEntry).not.toHaveBeenCalled();
  });

  test("falls back to text when a restored image is blocked by the current model", async () => {
    const blockedModel: LlmModel = {
      ...baseModel,
      apiType: LlmApiType.Anthropic,
      supportsComputerUse: true,
    };
    const { contextManager, pushEntry, sessionService, upload } =
      buildRestoreHarness(
        {
          entries: [
            {
              source: "console",
              message: "[Image: blocked.png]",
              attachment: {
                publicId: "blocked-public",
                filename: "blocked.png",
              },
            },
          ],
        },
        {
          controlDesktop: true,
          model: blockedModel,
          buffers: { "blocked-public": Buffer.from("blocked-image") },
        },
      );

    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: true,
      stale: false,
    });

    const messages = contextManager.exportedForTesting.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("[Image: blocked.png]");
    expect(upload).not.toHaveBeenCalled();
    // Silent replay — fallback text doesn't re-log either.
    expect(pushEntry).not.toHaveBeenCalled();
  });

  test("falls back to text when a restored audio entry's current model doesn't support hearing", async () => {
    const noHearingModel: LlmModel = {
      ...baseModel,
      supportsHearing: false,
    };
    const { contextManager, pushEntry, sessionService, upload } =
      buildRestoreHarness(
        {
          entries: [
            {
              source: "console",
              message: "[Audio: voice.mp3]",
              attachment: {
                publicId: "audio-public",
                filename: "voice.mp3",
              },
            },
          ],
        },
        {
          model: noHearingModel,
          buffers: { "audio-public": Buffer.from("audio-bytes") },
        },
      );

    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: true,
      stale: false,
    });

    const messages = contextManager.exportedForTesting.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("[Audio: voice.mp3]");
    expect(upload).not.toHaveBeenCalled();
    expect(pushEntry).not.toHaveBeenCalled();
  });

  test("stale flag propagates through replay and the bundle is consumed once", async () => {
    const { sessionService } = buildRestoreHarness({
      summary: "prior summary",
      entries: [
        { source: "console", message: "prior summary" },
        { source: "llm", message: "agent reply after compact" },
      ],
      stale: true,
      cursor: { runId: 7, sessionId: 2 },
    });

    expect(sessionService.hasPendingRestoreEntries()).toBe(true);
    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: true,
      stale: true,
    });
    // Second call sees the consumed state — guards against the stale flag
    // leaking into a follow-up iteration after entries are gone.
    expect(sessionService.hasPendingRestoreEntries()).toBe(false);
    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: false,
      stale: false,
    });
  });

  test("prepends a fallback restored summary when the post-compact echo is missing from the tail", async () => {
    const { contextManager, output, sessionService } = buildRestoreHarness({
      summary: "the saved summary text",
      entries: [
        { source: "llm", message: "agent message with no echo of the summary" },
        { source: "console", message: "unrelated shell output" },
      ],
      cursor: { runId: 3, sessionId: 1 },
    });

    await expect(sessionService.replayRestoreEntries()).resolves.toEqual({
      replayed: true,
      stale: false,
    });

    // The fallback fires loudly so a regression in restore logging is noticed.
    expect(output.errorAndLog).toHaveBeenCalledWith(
      expect.stringContaining("did not include the compact summary"),
    );

    // Fallback prepend lands at the head of replay so the agent's context
    // still contains the summary text.
    const messages = contextManager.exportedForTesting.getMessages();
    expect(messages[0].content).toContain("[Restored summary]");
    expect(messages[0].content).toContain("the saved summary text");
  });

  test("does not warn when an echoing console entry carries the summary into the tail", async () => {
    const { output, sessionService } = buildRestoreHarness({
      summary: "echoed summary text",
      entries: [
        // The post-compact `ns-session restore` echo — a console-source
        // entry whose message is exactly the summary. Replay should treat
        // it as the summary's natural carrier and skip the fallback.
        { source: "console", message: "echoed summary text" },
        { source: "llm", message: "follow-up reply after restore" },
      ],
      cursor: { runId: 4, sessionId: 1 },
    });

    await sessionService.replayRestoreEntries();

    expect(output.errorAndLog).not.toHaveBeenCalled();
  });
});

describe("ns-session clear", () => {
  test("logs a compact row carrying the clear message and triggers a session restart", async () => {
    const { pushEntry, sessionService } = buildRestoreHarness({});

    const result = await sessionService.handleCommand("clear");

    if (typeof result === "string") {
      throw new Error(`Expected CommandResponse, got string: ${result}`);
    }

    expect(result.nextCommandResponse?.nextCommandAction).toBe(
      NextCommandAction.CompactSession,
    );

    // The hub mirrors a `type: "compact"` row into compact_log_id, so the
    // next AGENT_START's cursor points at this entry — the next agent's
    // resumed context will be exactly the clear message, not prior history.
    const compactWrites = pushEntry.mock.calls.filter(
      ([entry]) => entry.type === "compact",
    );
    expect(compactWrites).toHaveLength(1);
    expect(compactWrites[0][0].message).toBe("Previous Session Cleared");
  });
});
