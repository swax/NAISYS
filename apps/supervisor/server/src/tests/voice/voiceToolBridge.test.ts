import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRunSession: vi.fn(),
  loggerError: vi.fn(),
  resolveAgentId: vi.fn(),
  sendAgentRunCommand: vi.fn(),
  sendChatMessage: vi.fn(),
}));

vi.mock("../../database/hubDb.js", () => ({
  hubDb: {
    run_session: {
      findFirst: mocks.findRunSession,
    },
  },
}));

vi.mock("../../logger.js", () => ({
  getLogger: () => ({
    error: mocks.loggerError,
  }),
}));

vi.mock("../../services/agents/agentService.js", () => ({
  resolveAgentId: mocks.resolveAgentId,
}));

vi.mock("../../services/comms/chatService.js", () => ({
  sendChatMessage: mocks.sendChatMessage,
}));

vi.mock("../../services/comms/hubConnectionService.js", () => ({
  sendAgentRunCommand: mocks.sendAgentRunCommand,
}));

import {
  executeVoiceTool,
  requiredPermissionForVoiceTool,
} from "../../services/voice/voiceToolBridge.js";

describe("voiceToolBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAgentId.mockReturnValue(42);
    mocks.sendChatMessage.mockResolvedValue({ success: true });
    mocks.findRunSession.mockResolvedValue({
      run_id: 7,
      session_id: 3,
      subagent_id: 0,
    });
    mocks.sendAgentRunCommand.mockResolvedValue({ success: true });
  });

  test("maps voice tools to the least required permission", () => {
    expect(requiredPermissionForVoiceTool("talk_to_agent")).toBe(
      "agent_communication",
    );
    expect(requiredPermissionForVoiceTool("run_debug_command")).toBe(
      "remote_execution",
    );
    expect(requiredPermissionForVoiceTool("run_command")).toBe(
      "remote_execution",
    );
  });

  test("sends talk_to_agent through the normal chat path", async () => {
    const result = await executeVoiceTool(
      { id: 9, username: "admin" },
      {
        tool: "talk_to_agent",
        voiceSessionId: "voice-session-id",
        targetUsername: "worker",
        message: "please continue",
      },
    );

    expect(mocks.resolveAgentId).toHaveBeenCalledWith("worker");
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(
      9,
      [42],
      "please continue",
    );
    expect(mocks.findRunSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      result: "Message sent to worker as admin.",
    });
  });

  test("returns a model-readable failure for unknown targets", async () => {
    mocks.resolveAgentId.mockReturnValue(undefined);

    await expect(
      executeVoiceTool(
        { id: 9, username: "admin" },
        {
          tool: "talk_to_agent",
          voiceSessionId: "voice-session-id",
          targetUsername: "missing",
          message: "hello",
        },
      ),
    ).resolves.toEqual({
      success: false,
      result: 'Unknown agent "missing".',
    });
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendAgentRunCommand).not.toHaveBeenCalled();
  });

  test("runs debug commands without adding them to agent context", async () => {
    const result = await executeVoiceTool(
      { id: 9, username: "admin" },
      {
        tool: "run_debug_command",
        voiceSessionId: "voice-session-id",
        targetUsername: "worker",
        command: "pwd",
      },
    );

    expect(mocks.findRunSession).toHaveBeenCalledWith({
      where: { user_id: 42 },
      orderBy: { last_active: "desc" },
      select: { run_id: true, session_id: true, subagent_id: true },
    });
    expect(mocks.sendAgentRunCommand).toHaveBeenCalledWith(
      42,
      7,
      3,
      "pwd",
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.result).toContain("as a diagnostic");
  });

  test("prefixes run_command and preserves negative subagent ids", async () => {
    mocks.findRunSession.mockResolvedValue({
      run_id: 7,
      session_id: 3,
      subagent_id: -2,
    });

    const result = await executeVoiceTool(
      { id: 9, username: "admin" },
      {
        tool: "run_command",
        voiceSessionId: "voice-session-id",
        targetUsername: "worker",
        command: "npm test",
      },
    );

    expect(mocks.sendAgentRunCommand).toHaveBeenCalledWith(
      42,
      7,
      3,
      "!npm test",
      -2,
    );
    expect(result.success).toBe(true);
    expect(result.result).toContain("were added to the agent's context");
  });

  test("does not dispatch commands when the target has no active run", async () => {
    mocks.findRunSession.mockResolvedValue(null);

    const result = await executeVoiceTool(
      { id: 9, username: "admin" },
      {
        tool: "run_command",
        voiceSessionId: "voice-session-id",
        targetUsername: "worker",
        command: "npm test",
      },
    );

    expect(mocks.sendAgentRunCommand).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.result).toContain("has no active run");
    expect(result.result).toContain("Use talk_to_agent instead");
  });

  test("returns dispatch errors instead of throwing them", async () => {
    mocks.sendAgentRunCommand.mockResolvedValue({
      success: false,
      error: "host is offline",
    });

    const result = await executeVoiceTool(
      { id: 9, username: "admin" },
      {
        tool: "run_debug_command",
        voiceSessionId: "voice-session-id",
        targetUsername: "worker",
        command: "pwd",
      },
    );

    expect(result.success).toBe(false);
    expect(result.result).toContain("host is offline");
    expect(result.result).toContain("use talk_to_agent instead");
  });
});
