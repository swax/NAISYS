import { jest, test } from "@jest/globals";

export function mockConfig() {
  jest.unstable_mockModule("../config.js", () => ({
    agent: {
      tokenMax: 2000,
    },
    resolveConfigVars: jest.fn(() => ""),
  }));
}

export function createMockConfig() {
  return {
    hostname: "test",
    agent: {
      username: "test",
      debugPauseSeconds: 0,
      wakeOnMessage: false,
      disableMultipleCommands: false,
      leadAgent: undefined,
      spendLimitDollars: undefined,
      tokenMax: 2000,
    },
    mailEnabled: false,
    trimSessionEnabled: false,
    endSessionEnabled: false,
    resolveConfigVars: (str: string) => str,
  } as any;
}

export function mockFs() {
  const mockWriteStream = {
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };

  const mockFs = {
    existsSync: jest.fn(() => true),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(() => ""),
    appendFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    statSync: jest.fn(() => ({ isDirectory: () => false })),
    unlinkSync: jest.fn(),
    rmdirSync: jest.fn(),
    createWriteStream: jest.fn(() => mockWriteStream),
    readFile: jest.fn(() => Promise.resolve("")),
    writeFile: jest.fn(() => Promise.resolve()),
    mkdir: jest.fn(() => Promise.resolve()),
    readdir: jest.fn(() => Promise.resolve([])),
    stat: jest.fn(() => Promise.resolve({ isDirectory: () => false })),
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

export class MockNaisysPath {
  constructor(public path: string) {}
  toHostPath() { return this.path; }
}

export function mockPathService() {
  jest.unstable_mockModule("../services/pathService.js", () => ({
    NaisysPath: MockNaisysPath,
    getHostPath: jest.fn(() => "/test/path"),
    ensureFileDirExists: jest.fn(),
    ensureDirExists: jest.fn(),
  }));
}

export function mockDbService() {
  jest.unstable_mockModule("../services/dbService.js", () => ({
    myUserId: 1,
    initDatabase: jest.fn(() => Promise.resolve()),
    openDatabase: jest.fn(() => Promise.resolve({
      get: jest.fn(),
      all: jest.fn(() => []),
      run: jest.fn(),
      close: jest.fn(),
    })),
    updateLastActive: jest.fn(() => Promise.resolve()),
    usingDatabase: jest.fn((callback: any) => callback({
      get: jest.fn(),
      all: jest.fn(() => []),
      run: jest.fn(),
    })),
  }));
}

export function mockSubagent() {
  jest.unstable_mockModule("../features/subagent.js", () => ({
    handleCommand: jest.fn(),
    getTerminationEvents: jest.fn(() => []),
    unreadContextSummary: jest.fn(),
  }));
}

export function mockCommandProtection() {
  const mockValidateCommand = jest.fn(() => Promise.resolve({
    commandAllowed: true,
  }));

  jest.unstable_mockModule("../command/commandProtection.js", () => ({
    createCommandProtection: jest.fn(() => ({
      validateCommand: mockValidateCommand,
    })),
  }));

  return { mockValidateCommand };
}

test("nothing", () => {});
