import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HubEvents } from "@naisys/hub-protocol";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysServer } from "../services/naisysServer.js";
import { createHubRedactionService } from "./hubRedactionService.js";

type EventHandler = (...args: unknown[]) => void | Promise<void>;

function createServerHarness() {
  const handlers = new Map<string, EventHandler>();
  const server = {
    registerEvent: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
  } as unknown as NaisysServer;

  async function emit(event: string, ...args: unknown[]) {
    const handler = handlers.get(event);
    if (!handler) throw new Error(`No handler for ${event}`);
    await handler(...args);
  }

  return { server, emit };
}

function createHubDb(initialRows: { key: string; value: string; sensitive: boolean }[]) {
  let rows = [...initialRows];
  const hubDb = {
    variables: {
      findMany: vi.fn(({ where }: { where: { sensitive: boolean } }) =>
        Promise.resolve(rows.filter((r) => r.sensitive === where.sensitive)),
      ),
    },
  } as unknown as PrismaClient;

  return {
    hubDb,
    setRows: (next: typeof initialRows) => {
      rows = [...next];
    },
  };
}

function createLogger(): DualLogger {
  return {
    log: vi.fn(),
    error: vi.fn(),
    disableConsole: vi.fn(),
  } as unknown as DualLogger;
}

describe("hubRedactionService", () => {
  let server: NaisysServer;
  let emit: (event: string, ...args: unknown[]) => Promise<void>;

  beforeEach(() => {
    const harness = createServerHarness();
    server = harness.server;
    emit = harness.emit;
  });

  test("redacts sensitive variable values", async () => {
    const { hubDb } = createHubDb([
      { key: "OPENAI_API_KEY", value: "sk-abc123def456", sensitive: true },
      { key: "PUBLIC_VAR", value: "not-a-secret", sensitive: false },
    ]);

    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact("call with sk-abc123def456 here")).toBe(
      "call with [REDACTED:OPENAI_API_KEY] here",
    );
    expect(svc.redact("not-a-secret stays")).toBe("not-a-secret stays");
  });

  test("skips sensitive values shorter than 6 chars", async () => {
    const { hubDb } = createHubDb([
      { key: "SHORT", value: "abc", sensitive: true },
      { key: "LONG_ENOUGH", value: "123456", sensitive: true },
    ]);

    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact("abc and 123456")).toBe("abc and [REDACTED:LONG_ENOUGH]");
  });

  test("longest-first ordering avoids partial replacement", async () => {
    const { hubDb } = createHubDb([
      { key: "SHORT_KEY", value: "abc123", sensitive: true },
      { key: "LONG_KEY", value: "abc1234567", sensitive: true },
    ]);

    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact("token=abc1234567")).toBe(
      "token=[REDACTED:LONG_KEY]",
    );
  });

  test("registers and revokes runtime API keys per user", async () => {
    const { hubDb } = createHubDb([]);
    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    svc.registerRuntimeApiKey(7, "deadbeefcafebabe");
    expect(svc.redact("auth=deadbeefcafebabe")).toBe(
      "auth=[REDACTED:NAISYS_API_KEY:7]",
    );

    svc.revokeRuntimeApiKey(7);
    expect(svc.redact("auth=deadbeefcafebabe")).toBe(
      "auth=deadbeefcafebabe",
    );
  });

  test("registering a new key for the same user replaces the prior", async () => {
    const { hubDb } = createHubDb([]);
    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    svc.registerRuntimeApiKey(7, "oldkey1234567");
    svc.registerRuntimeApiKey(7, "newkey7654321");

    expect(svc.redact("oldkey1234567 and newkey7654321")).toBe(
      "oldkey1234567 and [REDACTED:NAISYS_API_KEY:7]",
    );
  });

  test("pattern fallbacks catch shapes not in the secret list", async () => {
    const { hubDb } = createHubDb([]);
    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact("Authorization: Bearer xyz.token.here")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
    expect(svc.redact("AKIAIOSFODNN7EXAMPLE")).toBe("[REDACTED:AWS_KEY]");
    expect(
      svc.redact(
        "header eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c trail",
      ),
    ).toBe("header [REDACTED:JWT] trail");
  });

  test("redact returns empty string for null/undefined", async () => {
    const { hubDb } = createHubDb([]);
    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact(null)).toBe("");
    expect(svc.redact(undefined)).toBe("");
    expect(svc.redact("")).toBe("");
  });

  test("rebuilds dbSecrets on VARIABLES_CHANGED", async () => {
    const { hubDb, setRows } = createHubDb([
      { key: "OLD_KEY", value: "old-secret-value", sensitive: true },
    ]);

    const svc = await createHubRedactionService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
    );

    expect(svc.redact("old-secret-value")).toBe("[REDACTED:OLD_KEY]");

    setRows([{ key: "NEW_KEY", value: "new-secret-value", sensitive: true }]);
    await emit(HubEvents.VARIABLES_CHANGED, 1);

    expect(svc.redact("old-secret-value")).toBe("old-secret-value");
    expect(svc.redact("new-secret-value")).toBe("[REDACTED:NEW_KEY]");
  });
});
