import { describe, expect, jest, test } from "@jest/globals";
import { createPromptBuilder } from "../../command/promptBuilder.js";
import { createShellWrapper } from "../../command/shellWrapper.js";
import {
  createMockConfig,
  mockCommandProtection,
  mockConfig,
  mockDbService,
  mockFs,
  mockPathService,
  mockSqlite,
  mockSubagent,
} from "../mocks.js";
/*
mockConfig();
mockFs();
mockSqlite();
mockPathService();
mockDbService();
mockSubagent();
mockCommandProtection();

// Mock promptBuilder module (test-specific)
const userHostPrompt = "bob@naisys";
const userHostPathPrompt = "bob@naisys:/home/bob";

const mockGetUserHostPrompt = jest.fn(() => userHostPrompt);
const mockGetUserHostPathPrompt = jest.fn(() => userHostPathPrompt);

jest.unstable_mockModule("../../command/promptBuilder.js", () => ({
  getUserHostPrompt: mockGetUserHostPrompt,
  getUserHostPathPrompt: mockGetUserHostPathPrompt,
}));

// Load target modules
const { createCommandHandler } = await import(
  "../../command/commandHandler.js"
);
const { createCommandProtection } = await import(
  "../../command/commandProtection.js"
);

// Create an instance to access testing methods
const shellWrapperInstance = createShellWrapper();
const promptBuilderInstance = createPromptBuilder(shellWrapperInstance);
const commandProtectionInstance = createCommandProtection(
  promptBuilderInstance,
);
const commandHandlerInstance = createCommandHandler(
  createMockConfig(),
  commandProtectionInstance,
  promptBuilderInstance,
  shellWrapperInstance,
);
const { popFirstCommand } = commandHandlerInstance.exportedForTesting;

describe("popFirstCommand function", () => {
  test("handles input with a prompt at beginning", async () => {
    // Arrange
    const nextInput = `${userHostPathPrompt}$ command1`;
    const commandList = [nextInput];

    // Act
    const result = await popFirstCommand(commandList);

    // Assert
    expect(result).toEqual({
      input: "",
      splitResult: "inputInPrompt",
    });
    expect(commandList).toEqual(["command1"]);
  });

  test("handles input with wrong prompt at beginning", async () => {
    // Arrange
    const wrongPathPrompt = `${userHostPrompt}:/wrong`;
    const nextInput = `${wrongPathPrompt}$ command1`;
    const commandList = [nextInput];

    // Act
    const result = await popFirstCommand(commandList);

    // Assert
    expect(result).toEqual({
      input: "",
      splitResult: "inputPromptMismatch",
    });
    expect(commandList).toEqual([nextInput]);
  });

  test("handle input with prompt in the middle", async () => {
    // Arrange
    const nextInput = `command1\n${userHostPathPrompt}$ command2`;
    const commandList = [nextInput];

    // Act
    const result = await popFirstCommand(commandList);

    // Assert
    expect(result).toEqual({
      input: "command1\n",
      splitResult: "sliced",
    });
    expect(commandList).toEqual([`${userHostPathPrompt}$ command2`]);
  });

  test("handles comment command in quotes", async () => {
    // Arrange
    const commentCommand = `comment "Today
        \\"is\\"
        Tuesday"`;
    const nextInput = `${commentCommand}\ncommand2`;
    const commandList = [nextInput];

    // Act
    const result = await popFirstCommand(commandList);

    // Assert
    expect(result).toEqual({
      input: commentCommand,
      splitResult: "sliced",
    });
    expect(commandList).toEqual(["command2"]);
  });

  test("handles input with nothing special", async () => {
    // Arrange
    const nextInput = "command1 --help\n";
    const commandList = [nextInput];

    // Act
    const result = await popFirstCommand(commandList);

    // Assert
    expect(result).toEqual({
      input: "command1 --help",
      splitResult: "popped",
    });
    expect(commandList).toEqual([]);
  });
});
*/