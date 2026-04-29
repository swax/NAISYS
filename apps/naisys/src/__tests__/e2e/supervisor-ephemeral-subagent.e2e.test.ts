/** E2E: ephemeral subagents appear as subagent-scoped run sessions under
 * the parent, and the subagent-scoped supervisor routes work. */

import { sleep } from "@naisys/common";
import type {
  AgentDetailResponse,
  AgentRunCommandResult,
  AgentRunPauseResult,
  AgentStartResult,
  ContextLogResponse,
  RunsDataResponse,
} from "@naisys/supervisor-shared";
import { writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";
import { loginAsSuperAdmin, waitFor } from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 150000 });

describe("Supervisor ephemeral subagent E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const HOSTNAME = "TEST-SUPERVISOR-EPHEMERAL";
  let SERVER_PORT: number;
  let API_BASE: string;

  beforeEach(async () => {
    testDir = getTestDir("supervisor_ephemeral_subagent");
    setupTestDir(testDir);
    SERVER_PORT = await getFreePort();
    API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    // Intentionally no SPEND_LIMIT_DOLLARS: parent has a per-agent limit via
    // alex.yaml, and ephemeral subagents must inherit that delegation rather
    // than tripping config validation.
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="${HOSTNAME}"
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("creates ephemeral subagents and exposes their scoped run controls", async () => {
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "alex.yaml", {
      username: "alex",
      title: "Lead Agent",
      mailEnabled: true,
      chatEnabled: true,
    });

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", testDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const api = await loginAsSuperAdmin(naisys, API_BASE);

    const start = await api.post<AgentStartResult>("/agents/alex/start", {
      task: "Ephemeral subagent supervisor workflow",
    });
    expect(start.success).toBe(true);

    await waitFor(
      "alex to become active",
      () => api.get<AgentDetailResponse>("/agents/alex"),
      (agent) => agent.status === "active",
    );

    await naisys.switchAgent("alex");

    async function createEphemeralSubagent(title: string, task: string) {
      const createOutput = await naisys!.runCommand(
        `ns-agent create "${title}" "${task}"`,
        { waitFor: "created and started", timeoutMs: 30000 },
      );
      const created = createOutput.match(/Subagent '([^']+)'/);
      expect(created).not.toBeNull();
      return created![1];
    }

    const firstSubagentName = await createEphemeralSubagent(
      "Research Helper",
      "wait for supervisor commands",
    );
    const secondSubagentName = await createEphemeralSubagent(
      "Audit Helper",
      "wait for separate supervisor commands",
    );
    expect(secondSubagentName).not.toBe(firstSubagentName);

    const listOutput = await naisys.runCommand("ns-agent list");
    expect(listOutput).toContain(firstSubagentName);
    expect(listOutput).toContain(secondSubagentName);
    expect(listOutput).toContain("running");

    const runs = await waitFor(
      "alex runs to include two ephemeral subagents",
      () => api.get<RunsDataResponse>("/agents/alex/runs?count=10"),
      (response) =>
        (response.data?.runs.filter((run) => (run.subagentId ?? 0) < 0)
          .length ?? 0) >= 2,
    );
    const subagentRuns = runs
      .data!.runs.filter((run) => (run.subagentId ?? 0) < 0)
      .slice(0, 2);
    const subagentIds = subagentRuns.map((run) => run.subagentId);
    expect(new Set(subagentIds).size).toBe(2);

    const [firstSubagentRun, secondSubagentRun] = subagentRuns;
    const parentRun = runs.data!.runs.find(
      (run) =>
        run.runId === firstSubagentRun.runId &&
        run.sessionId === firstSubagentRun.sessionId &&
        run.subagentId == null,
    );

    expect(parentRun).toBeDefined();
    for (const subagentRun of subagentRuns) {
      expect(subagentRun.username).toBe("alex");
      expect(subagentRun.userId).toBe(parentRun!.userId);
      expect(subagentRun.runId).toBe(parentRun!.runId);
      expect(subagentRun.hostName).toBe(HOSTNAME);
    }

    const pause = await api.post<AgentRunPauseResult>(
      `/agents/alex/runs/${firstSubagentRun.runId}/subagents/${firstSubagentRun.subagentId}/sessions/${firstSubagentRun.sessionId}/pause`,
    );
    expect(pause.success).toBe(true);

    const resume = await api.post<AgentRunPauseResult>(
      `/agents/alex/runs/${firstSubagentRun.runId}/subagents/${firstSubagentRun.subagentId}/sessions/${firstSubagentRun.sessionId}/resume`,
    );
    expect(resume.success).toBe(true);

    const subagentRoute = (
      run: (typeof subagentRuns)[number],
      action: "logs" | "command",
    ) =>
      `/agents/alex/runs/${run.runId}/subagents/${run.subagentId}/sessions/${run.sessionId}/${action}`;

    const firstMarker = `subagent-supervisor-command-${Math.abs(firstSubagentRun.subagentId!)}`;
    const secondMarker = `subagent-supervisor-command-${Math.abs(secondSubagentRun.subagentId!)}`;

    for (const [run, marker] of [
      [firstSubagentRun, firstMarker],
      [secondSubagentRun, secondMarker],
    ] as const) {
      const command = await api.post<AgentRunCommandResult>(
        subagentRoute(run, "command"),
        { command: `echo ${marker}` },
      );
      expect(command.success).toBe(true);

      const logs = await waitFor(
        `subagent command output in subagent ${run.subagentId} logs`,
        () =>
          api.get<ContextLogResponse>(`${subagentRoute(run, "logs")}?limit=50`),
        (response) =>
          response.data?.logs.some((log) => log.message.includes(marker)) ??
          false,
        45000,
      );
      expect(logs.success).toBe(true);
    }

    const firstLogs = await api.get<ContextLogResponse>(
      `${subagentRoute(firstSubagentRun, "logs")}?limit=50`,
    );
    expect(
      firstLogs.data?.logs.some((log) => log.message.includes(firstMarker)) ??
        false,
    ).toBe(true);
    expect(
      firstLogs.data?.logs.some((log) => log.message.includes(secondMarker)) ??
        false,
    ).toBe(false);

    const secondLogs = await api.get<ContextLogResponse>(
      `${subagentRoute(secondSubagentRun, "logs")}?limit=50`,
    );
    expect(
      secondLogs.data?.logs.some((log) => log.message.includes(secondMarker)) ??
        false,
    ).toBe(true);
    expect(
      secondLogs.data?.logs.some((log) => log.message.includes(firstMarker)) ??
        false,
    ).toBe(false);

    const parentLogs = await api.get<ContextLogResponse>(
      `/agents/alex/runs/${firstSubagentRun.runId}/sessions/${firstSubagentRun.sessionId}/logs?limit=50`,
    );
    expect(
      parentLogs.data?.logs.some((log) => log.message.includes(firstMarker)) ??
        false,
    ).toBe(false);
    expect(
      parentLogs.data?.logs.some((log) => log.message.includes(secondMarker)) ??
        false,
    ).toBe(false);

    for (const subagentName of [firstSubagentName, secondSubagentName]) {
      const stopOutput = await naisys.runCommand(
        `ns-agent stop ${subagentName}`,
        {
          waitFor: "stop requested",
          timeoutMs: 30000,
        },
      );
      expect(stopOutput).toContain("stop requested");
    }

    await waitFor(
      "ephemeral subagents to be removed from the parent's list",
      () => naisys!.runCommand("ns-agent list", { timeoutMs: 15000 }),
      (output) => output.includes("No subagents."),
    );

    const localOutput = await naisys.runCommand("ns-agent local");
    expect(localOutput).not.toContain(firstSubagentName);
    expect(localOutput).not.toContain(secondSubagentName);

    await naisys.runCommand("exit all", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 15000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    naisys.dumpStderrIfAny();
  });
});
