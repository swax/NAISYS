import { describe, expect, test, vi } from "vitest";

import {
  NextCommandAction,
  timedWait,
} from "../../command/commandRegistry.js";
import { buildCommandLoop } from "../builders/commandLoop.js";

describe("commandLoop wait behavior", () => {
  test("applies retrySecondsBase as the backoff after an llm error", async () => {
    const { commandLoop, mocks } = buildCommandLoop({
      commandHandler: {
        processCommand: vi.fn().mockResolvedValue({
          nextCommandAction: NextCommandAction.ExitApplication,
        }),
      },
      llmService: {
        query: vi.fn().mockRejectedValueOnce(new Error("boom")),
      },
    });

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(mocks.llmService.query).toHaveBeenCalledTimes(1);
    expect(mocks.promptBuilder.getPrompt).toHaveBeenNthCalledWith(1, {
      kind: "none",
    });
    expect(mocks.promptBuilder.getPrompt).toHaveBeenNthCalledWith(2, {
      kind: "timed",
      seconds: 5,
    });
    expect(mocks.promptBuilder.getInput).toHaveBeenCalledWith(
      expect.any(String),
      { kind: "timed", seconds: 5 },
      expect.any(Function),
    );
  });

  test("lets triggerLlm bypass pause for one llm cycle", async () => {
    const { commandLoop, mocks } = buildCommandLoop({
      commandHandler: {
        processCommand: vi
          .fn()
          .mockResolvedValueOnce({
            nextCommandAction: NextCommandAction.Continue,
            triggerLlm: true,
          })
          .mockResolvedValueOnce({
            nextCommandAction: NextCommandAction.ExitApplication,
          }),
      },
      llmService: {
        query: vi.fn().mockResolvedValue({
          messagesTokenCount: 0,
          responses: ["exit"],
        }),
      },
    });
    commandLoop.setPaused(true);
    mocks.promptNotification.notify({
      wake: "always",
      userId: 1,
      debugCommands: ["ns-talk wait for me"],
    });
    vi.mocked(mocks.promptBuilder.getInput).mockResolvedValueOnce("");

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(mocks.llmService.query).toHaveBeenCalledTimes(1);
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      ["ns-talk wait for me"],
    );
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      ["exit"],
    );
  });

  test("pause overrides ordinary command waits instead of treating timeout as blank input", async () => {
    const processCommand = vi.fn(
      async (_prompt: string, commands: string[]) => {
        if (commands[0] === "ns-desktop wait 1") {
          return {
            nextCommandAction: NextCommandAction.Continue,
            wait: timedWait(1),
          };
        }
        if (commands[0] === "exit") {
          return {
            nextCommandAction: NextCommandAction.ExitApplication,
          };
        }
        return {
          nextCommandAction: NextCommandAction.Continue,
        };
      },
    );
    const { commandLoop, mocks } = buildCommandLoop({
      commandHandler: {
        processCommand,
      },
      llmService: {
        query: vi.fn().mockResolvedValue({
          messagesTokenCount: 0,
          responses: ["exit"],
        }),
      },
    });
    let inputCount = 0;
    vi.mocked(mocks.promptBuilder.getInput).mockImplementation(
      async (_prompt, wait) => {
        inputCount++;
        if (inputCount === 1) return "";
        return wait.kind === "indefinite" ? "exit" : "";
      },
    );

    commandLoop.setPaused(true);
    mocks.promptNotification.notify({
      wake: "always",
      userId: 1,
      debugCommands: ["ns-desktop wait 1"],
    });

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(mocks.llmService.query).not.toHaveBeenCalled();
    expect(mocks.promptBuilder.getInput).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      { kind: "indefinite" },
      expect.any(Function),
    );
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      ["ns-desktop wait 1"],
    );
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      ["exit"],
    );
  });

  test("lets blank debug input bypass pause for one llm cycle", async () => {
    const { commandLoop, mocks } = buildCommandLoop({
      commandHandler: {
        processCommand: vi
          .fn()
          .mockResolvedValueOnce({
            nextCommandAction: NextCommandAction.Continue,
          })
          .mockResolvedValueOnce({
            nextCommandAction: NextCommandAction.ExitApplication,
          }),
      },
      llmService: {
        query: vi.fn().mockResolvedValue({
          messagesTokenCount: 0,
          responses: ["exit"],
        }),
      },
    });
    commandLoop.setPaused(true);
    mocks.promptNotification.notify({
      wake: "always",
      userId: 1,
      debugCommands: [""],
    });
    vi.mocked(mocks.promptBuilder.getInput).mockResolvedValueOnce("");

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(mocks.llmService.query).toHaveBeenCalledTimes(1);
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      [""],
    );
    expect(mocks.commandHandler.processCommand).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      ["exit"],
    );
  });
});
