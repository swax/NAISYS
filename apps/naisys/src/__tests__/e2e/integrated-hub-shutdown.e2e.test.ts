/**
 * Integrated-hub shutdown regression E2E.
 *
 * Verifies the admin-only `exit all` path exits the process after printing
 * AGENT EXITED. This catches reconnect timers or server-side intervals that
 * keep the integrated hub process alive after shutdown.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import {
  io as createSocketIoClient,
  type Socket as SocketIoClient,
} from "socket.io-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createEnvFile,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";
import { generateSupervisorUserApiKey } from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 60000 });

describe("Integrated Hub Shutdown E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;
  let serverPort: number;
  let browserSocket: SocketIoClient | null = null;

  beforeEach(async () => {
    testDir = getTestDir("integrated_hub_shutdown");
    setupTestDir(testDir);
    serverPort = await getFreePort();
  });

  afterEach(async () => {
    browserSocket?.disconnect();
    browserSocket = null;
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("exit all with only admin stops the integrated hub and exits", async () => {
    createEnvFile(testDir);
    appendFileSync(join(testDir, ".env"), `\nSERVER_PORT=${serverPort}`);

    naisys = spawnNaisys(testDir, { args: ["--integrated-hub"] });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    await naisys.runCommand("exit all", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("Stopped 0 agent(s)");
    expect(fullOutput).toContain("[NAISYS] Exited");

    naisys.dumpStderrIfAny("Integrated hub shutdown");
  });

  test("exit with embedded supervisor and ERP stops reconnecting clients", async () => {
    createEnvFile(testDir, { naisysFolder: testDir });
    appendFileSync(join(testDir, ".env"), `\nSERVER_PORT=${serverPort}`);

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", "--erp"],
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const apiKey = await generateSupervisorUserApiKey(naisys, "superadmin");
    // Connect a browser socket so server-side connection state is non-empty at
    // shutdown — guards against handlers/intervals on the server side keeping
    // the process alive after exit.
    browserSocket = createSocketIoClient(`http://localhost:${serverPort}`, {
      path: "/supervisor/api/ws",
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    await waitForBrowserSocketConnect(browserSocket);
    browserSocket.emit("subscribe", { room: "hub-status" });

    await naisys.runCommand("exit", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("[NAISYS] Exited");

    naisys.dumpStderrIfAny("Integrated hub supervisor/ERP shutdown");
  });
});

function waitForBrowserSocketConnect(
  socket: SocketIoClient,
  timeoutMs = 15000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for browser socket connect")),
      timeoutMs,
    );
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onConnectError = (err: Error) => {
      cleanup();
      reject(err);
    };

    socket.once("connect", onConnect);
    socket.once("connect_error", onConnectError);
  });
}
