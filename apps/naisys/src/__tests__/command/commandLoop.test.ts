import { describe, expect, test, vi } from "vitest";

import { NextCommandAction } from "../../command/commandRegistry.js";
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
});
