import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../utils/escKeyListener.js", () => ({
  createEscKeyListener: () => ({
    start: (onEsc: () => void) => {
      onEsc();
      return () => {};
    },
  }),
}));

import { NextCommandAction } from "../../command/commandRegistry.js";
import { buildCommandLoop } from "../builders/commandLoop.js";

describe("commandLoop ESC cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns to debug mode with an indefinite wait after ESC cancels llm mode", async () => {
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
        query: vi.fn().mockRejectedValueOnce(new Error("aborted")),
      },
    });

    vi.mocked(mocks.promptBuilder.getInput)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("exit");
    vi.mocked(mocks.output.isConsoleEnabled).mockReturnValue(true);

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(mocks.promptBuilder.getInput).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      { kind: "indefinite" },
      expect.any(Function),
    );
  });
});
