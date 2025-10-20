import { describe, expect, jest, test } from "@jest/globals";
import { mockConfig, mockFs, mockSqlite } from "../mocks.js";

mockConfig();
mockFs();
mockSqlite();

// Mock promptBuilder module
const userHostPrompt = "bob@naisys";
const userHostPathPrompt = "bob@naisys:/home/bob";

const mockGetUserHostPrompt = jest.fn(() => userHostPrompt);
const mockGetUserHostPathPrompt = jest.fn(() => userHostPathPrompt);

jest.unstable_mockModule("../../command/promptBuilder.js", () => ({
  getUserHostPrompt: mockGetUserHostPrompt,
  getUserHostPathPrompt: mockGetUserHostPathPrompt,
}));

// Mock subagent module
jest.unstable_mockModule("../../features/subagent.js", () => ({
  handleCommand: jest.fn(),
}));

// Load target module
const commandHandler = await import("../../command/commandHandler.js");

const { popFirstCommand } =
  commandHandler.exportedForTesting;

describe("popFirstCommand function", () => {
  test("handles input with a prompt at beginning", async () => {
    // Arrange
    const nextInput = `${userHostPathPrompt}$ command1`;
    const expected = {
      input: "",
      nextInput: "command1",
      splitResult: "inputInPrompt",
    };

    // Act
    const result = await popFirstCommand([nextInput]);

    // Assert
    expect(result).toEqual(expected);
  });

  test("handles input with wrong prompt at beginning", async () => {
    // Arrange
    const wrongPathPrompt = `${userHostPrompt}:/wrong`;
    const nextInput = `${wrongPathPrompt}$ command1`;
    const expected = {
      input: "",
      nextInput,
      splitResult: "inputPromptMismatch",
    };

    // Act
    const result = await popFirstCommand([nextInput]);

    // Assert
    expect(result).toEqual(expected);
  });

  test("handle input with prompt in the middle", async () => {
    // Arrange
    const nextInput = `command1\n${userHostPathPrompt}$ command2`;
    const expected = {
      input: "command1\n",
      nextInput: `${userHostPathPrompt}$ command2`,
    };

    // Act
    const result = await popFirstCommand([nextInput]);

    // Assert
    expect(result).toEqual(expected);
  });

  test("handles comment command in quotes", async () => {
    // Arrange
    const commentCommand = `comment "Today 
        \\"is\\" 
        Tuesday"`;
    const nextInput = `${commentCommand}\ncommand2`;
    const expected = {
      input: commentCommand,
      nextInput: "command2",
    };

    // Act
    const result = await popFirstCommand([nextInput]);

    // Assert
    expect(result).toEqual(expected);
  });

  test("handles input with nothing special", async () => {
    // Arrange
    const nextInput = "command1 --help\n";
    const expected = {
      input: "command1 --help\n",
      nextInput: "",
    };

    // Act
    const result = await popFirstCommand([nextInput]);

    // Assert
    expect(result).toEqual(expected);
  });
});
