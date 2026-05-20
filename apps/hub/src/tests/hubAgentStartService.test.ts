import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import {
  type AgentStartDispatch,
  type AgentStartResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import { createHubAgentStartService } from "../lifecycle/hubAgentStartService.js";
import type { HubOwnershipService } from "../lifecycle/hubOwnershipService.js";
import type { NaisysServer } from "../server/naisysServer.js";

const START_USER_ID = 42;
const BEST_HOST_ID = 7;

type DisconnectHandler = (hostId: number) => void;
type StartAck = (response: AgentStartResponse) => void;
type StartupAttachmentRow = {
  path: string;
  attachment: {
    public_id: string;
    filename: string;
    file_size: number;
    file_hash: string;
  };
};
type CompactRow = {
  id: number;
  run_id: number;
  session_id: number;
  message: string;
};
type ContextRow = {
  source: "startPrompt" | "endPrompt" | "console" | "llm" | null;
  message: string;
  attachment: { public_id: string; filename: string } | null;
};

function createLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    disableConsole: vi.fn(),
  } as unknown as DualLogger;
}

async function waitForStartDispatch(sentStarts: unknown[]) {
  for (let i = 0; i < 20; i++) {
    if (sentStarts.length > 0) return;
    await Promise.resolve();
  }
  throw new Error("AGENT_START was not dispatched");
}

function buildHarness(opts?: {
  autoAck?: boolean;
  ackResponse?: AgentStartResponse;
  sendResult?: boolean;
  connected?: boolean;
  userConfig?: string;
  compactLogId?: number | null;
  compactRow?: CompactRow | null;
  contextRows?: ContextRow[];
  startupAttachments?: StartupAttachmentRow[];
}) {
  const disconnectHandlers = new Map<string, DisconnectHandler>();
  const sentStarts: Array<{
    hostId: number;
    event: string;
    payload: AgentStartDispatch;
    ack?: StartAck;
  }> = [];

  const server = {
    registerEvent: vi.fn((event: string, handler: DisconnectHandler) => {
      disconnectHandlers.set(event, handler);
    }),
    unregisterEvent: vi.fn((event: string, handler: DisconnectHandler) => {
      if (disconnectHandlers.get(event) === handler) {
        disconnectHandlers.delete(event);
      }
    }),
    sendMessage: vi.fn(
      (
        hostId: number,
        event: string,
        payload: AgentStartDispatch,
        ack?: StartAck,
      ) => {
        if (opts?.sendResult === false) return false;
        sentStarts.push({ hostId, event, payload, ack });
        if (opts?.autoAck !== false) {
          ack?.(
            opts?.ackResponse ?? {
              success: true,
              hostname: "naisys-host",
              modelName: "gpt-5",
            },
          );
        }
        return true;
      },
    ),
    getConnectionByHostId: vi.fn(() =>
      opts?.connected === false ? undefined : {},
    ),
    broadcastToSupervisors: vi.fn(),
  } as unknown as NaisysServer;

  const runSessionDeleteMany = vi.fn(() => Promise.resolve({ count: 0 }));
  const runSessionFindFirst = vi.fn(() => Promise.resolve({ run_id: 10 }));
  const runSessionCreate = vi.fn(() => Promise.resolve({}));
  const runSessionUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
  const startupAttachmentFindMany = vi.fn(() =>
    Promise.resolve(opts?.startupAttachments ?? []),
  );
  const userFindUnique = vi.fn(
    ({ select }: { select: Record<string, true> }) => {
      if (select.compact_log_id) {
        return Promise.resolve({ compact_log_id: opts?.compactLogId ?? null });
      }
      return Promise.resolve({ config: opts?.userConfig ?? "{}" });
    },
  );
  const contextLogFindUnique = vi.fn(() =>
    Promise.resolve(opts?.compactRow ?? null),
  );
  const contextLogFindMany = vi.fn(() =>
    Promise.resolve(opts?.contextRows ?? []),
  );

  const hubDb = {
    run_session: {
      deleteMany: runSessionDeleteMany,
      findFirst: runSessionFindFirst,
      create: runSessionCreate,
      updateMany: runSessionUpdateMany,
    },
    user_startup_attachments: {
      findMany: startupAttachmentFindMany,
    },
    users: {
      findUnique: userFindUnique,
    },
    context_log: {
      findUnique: contextLogFindUnique,
      findMany: contextLogFindMany,
    },
  } as unknown as PrismaClient;

  const ownershipService = {
    addStartedAgent: vi.fn(),
  } as unknown as HubOwnershipService;
  const runtimeKeyService = {
    issueRuntimeApiKey: vi.fn(() => Promise.resolve("runtime-key")),
  } as unknown as HubRuntimeKeyService;

  const service = createHubAgentStartService(
    server,
    { hubDb } as HubDatabaseService,
    createLogger(),
    ownershipService,
    runtimeKeyService,
  );

  // Ignore the constructor's stranded-placeholder sweep in assertions below.
  runSessionDeleteMany.mockClear();

  return {
    service,
    server,
    disconnectHandlers,
    sentStarts,
    runSessionDeleteMany,
    runSessionCreate,
    runSessionUpdateMany,
    ownershipService,
    runtimeKeyService,
  };
}

describe("hubAgentStartService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("dispatches complete start payload and finalizes the placeholder on success", async () => {
    const h = buildHarness({
      userConfig: JSON.stringify({ continuity: "summary" }),
      compactLogId: 55,
      compactRow: {
        id: 55,
        run_id: 4,
        session_id: 2,
        message: "compact summary",
      },
      contextRows: [
        {
          source: "console",
          message: "console tail",
          attachment: { public_id: "img-1", filename: "diagram.png" },
        },
        {
          source: "llm",
          message: "llm tail",
          attachment: { public_id: "ignored", filename: "ignored.png" },
        },
      ],
      startupAttachments: [
        {
          path: "config/seed.txt",
          attachment: {
            public_id: "att-1",
            filename: "seed.txt",
            file_size: 123,
            file_hash: "hash-1",
          },
        },
      ],
    });

    const response = await h.service.dispatchAgentStart({
      bestHostId: BEST_HOST_ID,
      payload: {
        startUserId: START_USER_ID,
        taskDescription: "do scheduled work",
        sourceHostId: 3,
      },
      triggeredBy: "schedule:morning",
    });

    expect(response).toMatchObject({
      success: true,
      hostname: "naisys-host",
      modelName: "gpt-5",
      runId: 11,
      sessionId: 1,
    });
    expect(h.runSessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: START_USER_ID,
        run_id: 11,
        session_id: 1,
        host_id: BEST_HOST_ID,
        model_name: "",
        triggered_by: "schedule:morning",
      }),
    });
    expect(h.sentStarts).toHaveLength(1);
    expect(h.sentStarts[0]).toMatchObject({
      hostId: BEST_HOST_ID,
      event: HubEvents.AGENT_START,
      payload: {
        startUserId: START_USER_ID,
        taskDescription: "do scheduled work",
        sourceHostId: 3,
        runtimeApiKey: "runtime-key",
        runId: 11,
        sessionId: 1,
        startupAttachments: [
          {
            publicId: "att-1",
            filename: "seed.txt",
            fileSize: 123,
            fileHash: "hash-1",
            path: "config/seed.txt",
          },
        ],
        restoreData: {
          summary: "compact summary",
          stale: true,
          cursor: { runId: 4, sessionId: 2 },
          entries: [
            {
              source: "console",
              message: "console tail",
              attachment: { publicId: "img-1", filename: "diagram.png" },
            },
            { source: "llm", message: "llm tail" },
          ],
        },
      },
    });
    expect(h.runSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        user_id: START_USER_ID,
        run_id: 11,
        subagent_id: 0,
        session_id: 1,
      },
      data: { model_name: "gpt-5" },
    });
    expect(h.ownershipService.addStartedAgent).toHaveBeenCalledWith(
      BEST_HOST_ID,
      START_USER_ID,
    );
  });

  test("rejects a duplicate start for the same user while the first ack is pending", async () => {
    const h = buildHarness({ autoAck: false });

    const first = h.service.dispatchAgentStart({
      bestHostId: BEST_HOST_ID,
      payload: { startUserId: START_USER_ID },
      triggeredBy: "wake-on-message",
    });
    await waitForStartDispatch(h.sentStarts);

    const duplicate = await h.service.dispatchAgentStart({
      bestHostId: BEST_HOST_ID,
      payload: { startUserId: START_USER_ID },
      triggeredBy: "schedule:morning",
    });

    expect(duplicate).toMatchObject({
      success: false,
      error: expect.stringContaining("already in flight"),
    });
    expect(h.runSessionCreate).toHaveBeenCalledTimes(1);
    expect(h.sentStarts).toHaveLength(1);

    h.sentStarts[0].ack?.({
      success: true,
      hostname: "naisys-host",
      modelName: "gpt-5",
    });
    await expect(first).resolves.toMatchObject({ success: true });
  });

  test("rolls back the placeholder when the host explicitly rejects the start", async () => {
    const h = buildHarness({
      ackResponse: {
        success: false,
        hostname: "naisys-host",
        error: "agent boot failed",
      },
    });

    const response = await h.service.dispatchAgentStart({
      bestHostId: BEST_HOST_ID,
      payload: { startUserId: START_USER_ID },
      triggeredBy: "manual",
    });

    expect(response).toMatchObject({
      success: false,
      error: "agent boot failed",
    });
    expect(h.runSessionDeleteMany).toHaveBeenCalledWith({
      where: {
        user_id: START_USER_ID,
        run_id: 11,
        subagent_id: 0,
        session_id: 1,
      },
    });
  });

  test("keeps the placeholder when the host disconnects before ack", async () => {
    const h = buildHarness({ autoAck: false });

    const start = h.service.dispatchAgentStart({
      bestHostId: BEST_HOST_ID,
      payload: { startUserId: START_USER_ID },
      triggeredBy: "schedule:morning",
    });
    await waitForStartDispatch(h.sentStarts);

    const disconnect = h.disconnectHandlers.get(HubEvents.CLIENT_DISCONNECTED);
    expect(disconnect).toBeDefined();
    disconnect?.(BEST_HOST_ID);

    await expect(start).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("start state unknown"),
    });
    expect(h.runSessionDeleteMany).not.toHaveBeenCalled();
    expect(h.server.unregisterEvent).toHaveBeenCalledWith(
      HubEvents.CLIENT_DISCONNECTED,
      disconnect,
    );
  });
});
