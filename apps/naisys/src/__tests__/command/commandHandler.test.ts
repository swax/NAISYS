import { describe, expect, test, vi } from "vitest";

import { createCommandHandler } from "../../command/commandHandler.js";
import { createCommandRegistry } from "../../command/commandRegistry.js";
import {
  createMockAgentConfig,
  createMockCommandLoopState,
  createMockCommandProtection,
  createMockContextManager,
  createMockGenImg,
  createMockGlobalConfig,
  createMockInputMode,
  createMockLynxService,
  createMockMailService,
  createMockOutputService,
  createMockPromptBuilder,
  createMockSessionService,
  createMockShellCommand,
  createMockShellWrapper,
  createMockSubagent,
} from "../mocks.js";

const userHostPrompt = "bob@naisys";
const userHostPathPrompt = "bob@naisys:/users/bob";

function createTestHandler() {
  const promptBuilder = createMockPromptBuilder(
    userHostPrompt,
    userHostPathPrompt,
  );
  const shellCommand = createMockShellCommand();
  const contextManager = createMockContextManager();
  const inputMode = createMockInputMode();

  const commandRegistry = createCommandRegistry(inputMode, [
    createMockLynxService(),
    createMockGenImg(),
    createMockSubagent(),
    createMockMailService(),
    createMockSessionService(),
  ]);

  const commandHandler = createCommandHandler(
    createMockGlobalConfig(),
    createMockAgentConfig(),
    createMockCommandProtection(),
    promptBuilder,
    shellCommand,
    createMockShellWrapper(),
    commandRegistry,
    contextManager,
    createMockOutputService(),
    inputMode,
    createMockCommandLoopState(),
    createMockSessionService(),
  );

  return {
    processCommand: commandHandler.processCommand,
    popFirstCommand: commandHandler.exportedForTesting.popFirstCommand,
    shellCommand,
    contextManager,
  };
}

describe("popFirstCommand function", () => {
  test("handles input with a prompt at beginning", async () => {
    const { popFirstCommand } = createTestHandler();
    const nextInput = `${userHostPathPrompt}$ command1`;
    const commandList = [nextInput];

    const result = await popFirstCommand(commandList);

    expect(result).toEqual({
      input: "",
      splitResult: "inputInPrompt",
    });
    expect(commandList).toEqual(["command1"]);
  });

  test("handles input with wrong prompt at beginning", async () => {
    const { popFirstCommand } = createTestHandler();
    const wrongPathPrompt = `${userHostPrompt}:/wrong`;
    const nextInput = `${wrongPathPrompt}$ command1`;
    const commandList = [nextInput];

    const result = await popFirstCommand(commandList);

    expect(result).toEqual({
      input: "",
      splitResult: "inputPromptMismatch",
    });
    expect(commandList).toEqual([nextInput]);
  });

  test("handle input with prompt in the middle", async () => {
    const { popFirstCommand } = createTestHandler();
    const nextInput = `command1\n${userHostPathPrompt}$ command2`;
    const commandList = [nextInput];

    const result = await popFirstCommand(commandList);

    expect(result).toEqual({
      input: "command1\n",
      splitResult: "sliced",
    });
    expect(commandList).toEqual([`${userHostPathPrompt}$ command2`]);
  });

  test("handles ns-comment command in quotes", async () => {
    const { popFirstCommand } = createTestHandler();
    const commentCommand = `ns-comment "Today
        \\"is\\"
        Tuesday"`;
    const nextInput = `${commentCommand}\ncommand2`;
    const commandList = [nextInput];

    const result = await popFirstCommand(commandList);

    expect(result).toEqual({
      input: commentCommand,
      splitResult: "sliced",
    });
    expect(commandList).toEqual(["command2"]);
  });

  test("handles input with nothing special", async () => {
    const { popFirstCommand } = createTestHandler();
    const nextInput = "command1 --help\n";
    const commandList = [nextInput];

    const result = await popFirstCommand(commandList);

    expect(result).toEqual({
      input: "command1 --help",
      splitResult: "popped",
    });
    expect(commandList).toEqual([]);
  });
});

describe("unknown ns- commands", () => {
  test("are reported, not handed to the shell", async () => {
    const { processCommand, shellCommand, contextManager } =
      createTestHandler();

    await processCommand("prompt", ["ns-bogus"]);

    // Never reaches the shell — so its command-not-found handler can't
    // mislabel the typo as "run it on its own line".
    expect(shellCommand.handleCommand).not.toHaveBeenCalled();

    const appendCalls = vi.mocked(contextManager.append).mock.calls;
    const appendedText = appendCalls.map((call) => call[0]).join("\n");
    expect(appendedText).toContain(
      "'ns-bogus' is not a recognized NAISYS command",
    );
    expect(appendedText).toContain("ns-help");
  });

  test("an unknown non-ns command still runs on the shell", async () => {
    const { processCommand, shellCommand } = createTestHandler();

    await processCommand("prompt", ["frobnicate --x"]);

    expect(shellCommand.handleCommand).toHaveBeenCalledWith("frobnicate --x");
  });
});
