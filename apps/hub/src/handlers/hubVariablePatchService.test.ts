import {
  OPENAI_CODEX_ACCESS_TOKEN_VAR,
  OPENAI_CODEX_EXPIRES_AT_VAR,
  OPENAI_CODEX_REFRESH_TOKEN_VAR,
} from "@naisys/common";
import { HubEvents } from "@naisys/hub-protocol";
import { describe, expect, test, vi } from "vitest";

import { createHubVariablePatchService } from "./hubVariablePatchService.js";

function createMocks() {
  const variables = {
    upsert: vi.fn(),
  };
  const hubDb = {
    $transaction: vi.fn(
      async (
        callback: (tx: { variables: typeof variables }) => Promise<unknown>,
      ) => callback({ variables }),
    ),
  };
  const configService = {
    broadcastConfig: vi.fn(async () => {}),
  };
  const redactionService = {
    rebuildDbSecrets: vi.fn(async () => {}),
  };
  const logService = {
    error: vi.fn(),
  };
  const naisysServer = {
    registerEvent: vi.fn(),
  };

  return {
    variables,
    hubDb,
    configService,
    redactionService,
    logService,
    naisysServer,
  };
}

type RegisteredPatchHandler = (
  hostId: number,
  request: unknown,
) => Promise<void>;

describe("hub variable patch service", () => {
  test("persists Codex OAuth variables with per-key policy and broadcasts config", async () => {
    const mocks = createMocks();
    createHubVariablePatchService(
      mocks.naisysServer as never,
      { hubDb: mocks.hubDb } as never,
      mocks.configService as never,
      mocks.redactionService as never,
      mocks.logService as never,
    );

    const [, handler, schema] = mocks.naisysServer.registerEvent.mock
      .calls[0] as [string, RegisteredPatchHandler, unknown];

    expect(mocks.naisysServer.registerEvent).toHaveBeenCalledWith(
      HubEvents.VARIABLE_PATCH,
      expect.any(Function),
      expect.any(Object),
    );
    expect(
      (
        schema as {
          safeParse: (value: unknown) => { success: boolean };
        }
      ).safeParse({
        updates: [{ key: OPENAI_CODEX_ACCESS_TOKEN_VAR, value: "access" }],
      }).success,
    ).toBe(true);

    await handler(42, {
      updates: [
        { key: OPENAI_CODEX_ACCESS_TOKEN_VAR, value: "access" },
        { key: OPENAI_CODEX_REFRESH_TOKEN_VAR, value: "refresh" },
        { key: OPENAI_CODEX_EXPIRES_AT_VAR, value: "1700000000000" },
      ],
    });

    expect(mocks.variables.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.variables.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: OPENAI_CODEX_ACCESS_TOKEN_VAR },
        update: expect.objectContaining({
          value: "access",
          export_to_shell: false,
          sensitive: true,
          updated_by: "host:42",
        }),
      }),
    );
    expect(mocks.variables.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: OPENAI_CODEX_EXPIRES_AT_VAR },
        update: expect.objectContaining({
          value: "1700000000000",
          export_to_shell: false,
          sensitive: false,
          updated_by: "host:42",
        }),
      }),
    );
    expect(mocks.redactionService.rebuildDbSecrets).toHaveBeenCalledOnce();
    expect(mocks.configService.broadcastConfig).toHaveBeenCalledOnce();
  });

  test("logs and skips persistence for non-allowlisted variables", async () => {
    const mocks = createMocks();
    createHubVariablePatchService(
      mocks.naisysServer as never,
      { hubDb: mocks.hubDb } as never,
      mocks.configService as never,
      mocks.redactionService as never,
      mocks.logService as never,
    );

    const [, handler] = mocks.naisysServer.registerEvent.mock.calls[0] as [
      string,
      RegisteredPatchHandler,
    ];

    await handler(7, {
      updates: [{ key: "GOOGLE_API_KEY", value: "secret" }],
    });

    expect(mocks.hubDb.$transaction).not.toHaveBeenCalled();
    expect(mocks.redactionService.rebuildDbSecrets).not.toHaveBeenCalled();
    expect(mocks.configService.broadcastConfig).not.toHaveBeenCalled();
    expect(mocks.logService.error).toHaveBeenCalledWith(
      expect.stringContaining("GOOGLE_API_KEY"),
    );
  });
});
