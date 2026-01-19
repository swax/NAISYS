import { describe, expect, test } from "@jest/globals";
import { createCommandHandler } from "../../command/commandHandler.js";
import { createCommandRegistry } from "../../command/commandRegistry.js";
import {
  createMockAgentConfig,
  createMockCommandProtection,
  createMockContextManager,
  createMockCostTracker,
  createMockSessionCompactor,
  createMockGenImg,
  createMockGlobalConfig,
  createMockInputMode,
  createMockLLMail,
  createMockLLMynx,
  createMockOutputService,
  createMockPromptBuilder,
  createMockRunService,
  createMockShellCommand,
  createMockSubagent,
} from "../mocks.js";

const userHostPrompt = "bob@naisys";
const userHostPathPrompt = "bob@naisys:/home/bob";

function createPopFirstCommand() {
  const promptBuilder = createMockPromptBuilder(
    userHostPrompt,
    userHostPathPrompt,
  );
  const shellCommand = createMockShellCommand();

  const llmail = createMockLLMail();
  const commandRegistry = createCommandRegistry([
    createMockLLMynx(),
    createMockGenImg(),
    createMockSubagent(),
    llmail,
  ]);

  const commandHandler = createCommandHandler(
    createMockGlobalConfig(),
    createMockAgentConfig(),
    createMockCommandProtection(),
    promptBuilder,
    shellCommand,
    commandRegistry,
    llmail,
    createMockSessionCompactor(),
    createMockContextManager(),
    createMockCostTracker(),
    createMockOutputService(),
    createMockInputMode(),
    createMockRunService(),
  );

  return {
    popFirstCommand: commandHandler.exportedForTesting.popFirstCommand,
  };
}

describe("popFirstCommand function", () => {
  test("handles input with a prompt at beginning", async () => {
    const { popFirstCommand } = createPopFirstCommand();
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
    const { popFirstCommand } = createPopFirstCommand();
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
    const { popFirstCommand } = createPopFirstCommand();
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
    const { popFirstCommand } = createPopFirstCommand();
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
    const { popFirstCommand } = createPopFirstCommand();
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
