import { jest, test } from "@jest/globals";

export function mockConfig() {
  jest.unstable_mockModule("../../config.js", () => ({
    agent: {
      tokenMax: 2000,
    },
    resolveConfigVars: jest.fn(() => ""),
  }));
}

export function mockFs() {
  const mockFs = {
    existsSync: jest.fn(() => true),
    writeFileSync: jest.fn(),
  };

  jest.unstable_mockModule("fs", () => mockFs);
}

export function mockSqlite() {
  const mockDatabase = {
    exec: jest.fn(),
    run: jest.fn(),
    get: jest.fn(() => ({})),
    close: jest.fn(),
  };

  jest.unstable_mockModule("sqlite", () => ({
    open: jest.fn(() => mockDatabase),
    Database: mockDatabase,
  }));
}

test("nothing", () => {});
