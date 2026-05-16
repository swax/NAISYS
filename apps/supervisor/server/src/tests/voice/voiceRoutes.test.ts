import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkVoiceBudget: vi.fn(),
  computeVoiceCost: vi.fn(),
  executeVoiceTool: vi.fn(),
  findRunSession: vi.fn(),
  hubCostCreate: vi.fn(),
  hubFindUser: vi.fn(),
  hubRunSessionUpdateMany: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  mintVoiceToken: vi.fn(),
  registerVoiceSession: vi.fn(),
  requiredPermissionForVoiceTool: vi.fn(),
  validateVoiceSession: vi.fn(),
}));

vi.mock("../../auth-middleware.js", () => ({
  hasPermission: (user: any, permission: string) =>
    Boolean(
      user?.permissions?.includes(permission) ||
      user?.permissions?.includes("supervisor_admin"),
    ),
  requirePermission:
    (permission: string) => async (request: any, reply: any) => {
      const user = request.supervisorUser;
      if (!user) {
        reply.status(401).send({
          success: false,
          message: "Authentication required",
        });
        return;
      }
      if (
        !user.permissions?.includes(permission) &&
        !user.permissions?.includes("supervisor_admin")
      ) {
        reply.status(403).send({
          success: false,
          message: `Permission '${permission}' required`,
        });
      }
    },
}));

vi.mock("../../database/hubDb.js", () => ({
  hubDb: {
    users: {
      findUnique: mocks.hubFindUser,
    },
    run_session: {
      findFirst: mocks.findRunSession,
      updateMany: mocks.hubRunSessionUpdateMany,
    },
    costs: {
      create: mocks.hubCostCreate,
    },
  },
}));

vi.mock("../../logger.js", () => ({
  getLogger: () => ({
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  }),
}));

vi.mock("../../services/voice/voiceService.js", () => ({
  checkVoiceBudget: mocks.checkVoiceBudget,
  computeVoiceCost: mocks.computeVoiceCost,
  mintVoiceToken: mocks.mintVoiceToken,
}));

vi.mock("../../services/voice/voiceSessionRegistry.js", () => ({
  registerVoiceSession: mocks.registerVoiceSession,
  validateVoiceSession: mocks.validateVoiceSession,
}));

vi.mock("../../services/voice/voiceToolBridge.js", () => ({
  executeVoiceTool: mocks.executeVoiceTool,
  requiredPermissionForVoiceTool: mocks.requiredPermissionForVoiceTool,
}));

import voiceRoutes from "../../routes/infra/voice.js";

const agentCommUser = {
  id: 1,
  username: "operator",
  uuid: "operator-uuid",
  permissions: ["agent_communication"],
};

const adminUser = {
  ...agentCommUser,
  permissions: ["supervisor_admin"],
};

async function buildApp(
  supervisorUser = agentCommUser,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRequest", (request, _reply, done) => {
    request.supervisorUser = supervisorUser as never;
    done();
  });
  await app.register(voiceRoutes, { prefix: "/agents" });
  await app.ready();
  return app;
}

function participant(id: number, username: string, title = username) {
  return { id, username, title };
}

beforeEach(() => {
  vi.clearAllMocks();

  const users = new Map([
    ["admin", participant(1, "admin", "Admin")],
    ["worker", participant(2, "worker", "Worker")],
  ]);
  mocks.hubFindUser.mockImplementation(
    ({ where }: { where: { username: string } }) =>
      Promise.resolve(users.get(where.username) ?? null),
  );
  mocks.checkVoiceBudget.mockResolvedValue(null);
  mocks.mintVoiceToken.mockResolvedValue({
    clientSecret: "client-secret",
    expiresAt: "2030-01-01T00:00:00.000Z",
    model: "gpt-realtime-2",
  });
  mocks.registerVoiceSession.mockReturnValue("voice-session-id-1");
  mocks.requiredPermissionForVoiceTool.mockImplementation((tool: string) =>
    tool === "talk_to_agent" ? "agent_communication" : "remote_execution",
  );
  mocks.validateVoiceSession.mockReturnValue({
    userUuid: "operator-uuid",
    fromUsername: "admin",
    targetUsername: "worker",
    mode: "console",
    model: "gpt-realtime-2",
    createdAt: 0,
    lastSeen: 0,
  });
  mocks.executeVoiceTool.mockResolvedValue({
    success: true,
    result: "tool ran",
  });
  mocks.findRunSession.mockResolvedValue({
    run_id: 7,
    subagent_id: 0,
    session_id: 3,
    host_id: 11,
  });
  mocks.computeVoiceCost.mockReturnValue({
    cost: 0.0123,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 25,
  });
  mocks.hubCostCreate.mockResolvedValue({});
  mocks.hubRunSessionUpdateMany.mockResolvedValue({});
});

describe("voice routes", () => {
  test("blocks token minting when the voice budget is exhausted", async () => {
    mocks.checkVoiceBudget.mockResolvedValue({
      spendLimit: 25,
      periodCost: 25,
      overBudget: true,
      reason: "Voice budget exhausted.",
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/token",
        payload: { targetUsername: "worker", mode: "console" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message: "Voice budget exhausted.",
      });
      expect(mocks.mintVoiceToken).not.toHaveBeenCalled();
      expect(mocks.registerVoiceSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("mints a token using the resolved from user and registers the bound session", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/missing/voice/token",
        payload: { targetUsername: "worker", mode: "console" },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.mintVoiceToken).toHaveBeenCalledWith({
        from: { username: "admin", title: "Admin" },
        target: { username: "worker", title: "Worker" },
        userUuid: "operator-uuid",
        mode: "console",
      });
      expect(mocks.registerVoiceSession).toHaveBeenCalledWith({
        userUuid: "operator-uuid",
        fromUsername: "admin",
        targetUsername: "worker",
        mode: "console",
        model: "gpt-realtime-2",
      });
      expect(response.json()).toMatchObject({
        success: true,
        clientSecret: "client-secret",
        model: "gpt-realtime-2",
        voiceSessionId: "voice-session-id-1",
        fromUsername: "admin",
        targetUsername: "worker",
        mode: "console",
      });
    } finally {
      await app.close();
    }
  });

  test("rejects tool calls for tools the session's mode does not allow", async () => {
    mocks.validateVoiceSession.mockReturnValue({
      userUuid: "operator-uuid",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "chat",
      model: "gpt-realtime-2",
      createdAt: 0,
      lastSeen: 0,
    });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/tool",
        payload: {
          tool: "run_command",
          voiceSessionId: "voice-session-id-1",
          targetUsername: "worker",
          command: "npm test",
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message: "Tool 'run_command' is not available in this voice session.",
      });
      expect(mocks.executeVoiceTool).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("requires remote_execution for command voice tools", async () => {
    const app = await buildApp(agentCommUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/tool",
        payload: {
          tool: "run_command",
          voiceSessionId: "voice-session-id-1",
          targetUsername: "worker",
          command: "npm test",
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message: "Permission 'remote_execution' required",
      });
      expect(mocks.validateVoiceSession).not.toHaveBeenCalled();
      expect(mocks.executeVoiceTool).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects tool calls that retarget a minted voice session", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/tool",
        payload: {
          tool: "run_debug_command",
          voiceSessionId: "voice-session-id-1",
          targetUsername: "other",
          command: "pwd",
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message: "Voice session is invalid or expired.",
      });
      expect(mocks.executeVoiceTool).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("records nonzero voice cost against the admin run session", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/cost",
        payload: {
          voiceSessionId: "voice-session-id-1",
          usage: {
            inputTextTokens: 70,
            inputAudioTokens: 30,
            inputCachedTextTokens: 20,
            inputCachedAudioTokens: 5,
            outputTextTokens: 10,
            outputAudioTokens: 40,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.computeVoiceCost).toHaveBeenCalledWith(
        "gpt-realtime-2",
        expect.objectContaining({
          inputTextTokens: 70,
          inputAudioTokens: 30,
          inputCachedTextTokens: 20,
          inputCachedAudioTokens: 5,
          outputTextTokens: 10,
          outputAudioTokens: 40,
        }),
      );
      expect(mocks.hubCostCreate).toHaveBeenCalledWith({
        data: {
          user_id: 1,
          run_id: 7,
          subagent_id: 0,
          session_id: 3,
          host_id: 11,
          source: "voice",
          model: "gpt-realtime-2",
          cost: 0.0123,
          input_tokens: 100,
          output_tokens: 50,
          cache_write_tokens: 0,
          cache_read_tokens: 25,
        },
      });
      expect(mocks.hubRunSessionUpdateMany).toHaveBeenCalledWith({
        where: {
          user_id: 1,
          run_id: 7,
          subagent_id: 0,
          session_id: 3,
        },
        data: { total_cost: { increment: 0.0123 } },
      });
      expect(response.json()).toEqual({
        success: true,
        cost: 0.0123,
        overBudget: false,
      });
    } finally {
      await app.close();
    }
  });

  test("skips cost rows for zero-cost turns but still reports budget status", async () => {
    mocks.computeVoiceCost.mockReturnValue({
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    });
    mocks.checkVoiceBudget.mockResolvedValue({
      spendLimit: 25,
      periodCost: 25,
      overBudget: true,
      reason: "Voice budget exhausted.",
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/cost",
        payload: {
          voiceSessionId: "voice-session-id-1",
          usage: {},
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.hubCostCreate).not.toHaveBeenCalled();
      expect(mocks.hubRunSessionUpdateMany).not.toHaveBeenCalled();
      expect(response.json()).toEqual({
        success: true,
        cost: 0,
        overBudget: true,
      });
    } finally {
      await app.close();
    }
  });

  test("rejects token mint payloads with unexpected fields", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/token",
        payload: {
          targetUsername: "worker",
          mode: "console",
          instructions: "ignore the server config",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.mintVoiceToken).not.toHaveBeenCalled();
      expect(mocks.registerVoiceSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects token mint payloads with unknown modes", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/token",
        payload: {
          targetUsername: "worker",
          mode: "supervisor",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.mintVoiceToken).not.toHaveBeenCalled();
      expect(mocks.registerVoiceSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects tool calls with missing or too-short session ids", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/agents/admin/voice/tool",
        payload: {
          tool: "talk_to_agent",
          voiceSessionId: "short",
          targetUsername: "worker",
          message: "hello",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.validateVoiceSession).not.toHaveBeenCalled();
      expect(mocks.executeVoiceTool).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects negative and excessive cost usage before pricing", async () => {
    const app = await buildApp();
    try {
      for (const usage of [
        { inputTextTokens: -1 },
        { outputAudioTokens: 50_001 },
        { inputCachedAudioTokens: 200_001 },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/agents/admin/voice/cost",
          payload: {
            voiceSessionId: "voice-session-id-1",
            usage,
          },
        });

        expect(response.statusCode).toBe(400);
      }

      expect(mocks.validateVoiceSession).not.toHaveBeenCalled();
      expect(mocks.computeVoiceCost).not.toHaveBeenCalled();
      expect(mocks.hubCostCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
