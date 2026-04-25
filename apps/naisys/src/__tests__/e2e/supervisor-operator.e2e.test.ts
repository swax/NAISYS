import { sleep } from "@naisys/common";
import type {
  AgentDetailResponse,
  AgentListResponse,
  AgentRunCommandResult,
  AgentRunPauseResult,
  AgentStartResult,
  AgentStopResult,
  ArchiveChatResponse,
  ArchiveMailResponse,
  AuthUser,
  ChatConversationsResponse,
  ChatMessagesResponse,
  CostsHistogramResponse,
  HostDetailResponse,
  HostListResponse,
  MailDataResponse,
  RunsDataResponse,
  SendChatResponse,
  SendMailResponse,
} from "@naisys/supervisor-shared";
import { writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 150000 });

describe("Supervisor Operator E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const SERVER_PORT = 4411;
  const HOSTNAME = "TEST-SUPERVISOR-OPERATOR";
  const API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;

  beforeEach(() => {
    testDir = getTestDir("supervisor_operator");
    setupTestDir(testDir);
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
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="${HOSTNAME}"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  async function parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Request failed with ${response.status} ${response.statusText}: ${text}`,
      );
    }
    return JSON.parse(text) as T;
  }

  async function login(adminPassword: string): Promise<string> {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "superadmin",
        password: adminPassword,
      }),
    });
    await parseJsonResponse<{ user: AuthUser }>(response);

    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) {
      throw new Error("Login response did not include a session cookie");
    }
    return cookie;
  }

  async function apiRequest<T>(
    cookie: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseJsonResponse<T>(response);
  }

  async function waitFor<T>(
    description: string,
    load: () => Promise<T>,
    isReady: (value: T) => boolean,
    timeoutMs = 30000,
  ): Promise<T> {
    const startTime = Date.now();
    let lastValue: T | undefined;

    while (Date.now() - startTime < timeoutMs) {
      lastValue = await load();
      if (isReady(lastValue)) {
        return lastValue;
      }
      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`,
    );
  }

  test("should operate an agent through the supervisor API", async () => {
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "operatorbot.yaml", {
      username: "operatorbot",
      title: "Operator Workflow Bot",
      mailEnabled: true,
      chatEnabled: true,
    });
    createAgentYaml(testDir, "peerbot.yaml", {
      username: "peerbot",
      title: "Peer Workflow Bot",
      mailEnabled: true,
      chatEnabled: true,
    });

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", testDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const passwordMatch = naisys
      .getFullOutput()
      .match(/superadmin user created\. Password: (\S+)/);
    expect(passwordMatch).not.toBeNull();
    const cookie = await login(passwordMatch![1]);

    const me = await apiRequest<AuthUser>(cookie, "GET", "/auth/me");
    expect(me.username).toBe("superadmin");

    const agents = await apiRequest<AgentListResponse>(
      cookie,
      "GET",
      "/agents",
    );
    const operator = agents.items.find((agent) => agent.name === "operatorbot");
    const peer = agents.items.find((agent) => agent.name === "peerbot");
    expect(operator).toBeDefined();
    expect(peer).toBeDefined();

    const hosts = await apiRequest<HostListResponse>(cookie, "GET", "/hosts");
    expect(hosts.items.some((host) => host.name === HOSTNAME)).toBe(true);

    const host = await apiRequest<HostDetailResponse>(
      cookie,
      "GET",
      `/hosts/${HOSTNAME}`,
    );
    expect(host.online).toBe(true);

    const start = await apiRequest<AgentStartResult>(
      cookie,
      "POST",
      "/agents/operatorbot/start",
      { task: "Supervisor operator workflow test" },
    );
    expect(start.success).toBe(true);

    await waitFor(
      "operatorbot to become active",
      () =>
        apiRequest<AgentDetailResponse>(cookie, "GET", "/agents/operatorbot"),
      (agent) => agent.status === "active",
    );

    const runs = await waitFor(
      "operatorbot to create a run session",
      () =>
        apiRequest<RunsDataResponse>(
          cookie,
          "GET",
          "/agents/operatorbot/runs?count=5",
        ),
      (response) => (response.data?.runs.length ?? 0) > 0,
    );
    const run = runs.data!.runs[0];
    expect(run.username).toBe("operatorbot");
    expect(run.hostName).toBe(HOSTNAME);

    const logs = await apiRequest<{
      success: boolean;
      data?: { logs: unknown[] };
    }>(
      cookie,
      "GET",
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/logs?limit=20`,
    );
    expect(logs.success).toBe(true);
    expect(Array.isArray(logs.data?.logs)).toBe(true);

    const command = await apiRequest<AgentRunCommandResult>(
      cookie,
      "POST",
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/command`,
      { command: "echo supervisor-operator-workflow" },
    );
    expect(command.success).toBe(true);

    const pause = await apiRequest<AgentRunPauseResult>(
      cookie,
      "POST",
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/pause`,
    );
    expect(pause.success).toBe(true);

    const resume = await apiRequest<AgentRunPauseResult>(
      cookie,
      "POST",
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/resume`,
    );
    expect(resume.success).toBe(true);

    const chatMessage = "operator workflow chat";
    const chat = await apiRequest<SendChatResponse>(
      cookie,
      "POST",
      "/agents/operatorbot/chat",
      {
        fromId: operator!.id,
        toIds: [peer!.id],
        message: chatMessage,
      },
    );
    expect(chat.success).toBe(true);

    const conversations = await waitFor(
      "peerbot chat conversation",
      () =>
        apiRequest<ChatConversationsResponse>(
          cookie,
          "GET",
          "/agents/peerbot/chat",
        ),
      (response) =>
        response.conversations.some(
          (conversation) =>
            conversation.participants.includes("operatorbot") &&
            conversation.participants.includes("peerbot") &&
            conversation.lastMessage === chatMessage,
        ),
    );
    expect(conversations.success).toBe(true);

    // Use whatever key the server returned rather than hardcoding the
    // participant join format, which the API does not document.
    const conversationKey = conversations.conversations.find(
      (c) =>
        c.participants.includes("operatorbot") &&
        c.participants.includes("peerbot"),
    )!.participants;
    const messages = await apiRequest<ChatMessagesResponse>(
      cookie,
      "GET",
      `/agents/peerbot/chat/${conversationKey}`,
    );
    expect(
      messages.messages.some((message) => message.body === chatMessage),
    ).toBe(true);

    const mailSubject = "Operator workflow";
    const mailBody = "mail from operator workflow";
    const mail = await apiRequest<SendMailResponse>(
      cookie,
      "POST",
      "/agents/operatorbot/mail",
      {
        fromId: operator!.id,
        toIds: [peer!.id],
        subject: mailSubject,
        message: mailBody,
      },
    );
    expect(mail.success).toBe(true);

    const peerMail = await waitFor(
      "peerbot mail message",
      () =>
        apiRequest<MailDataResponse>(
          cookie,
          "GET",
          "/agents/peerbot/mail?count=10",
        ),
      (response) =>
        response.data?.mail.some(
          (message) =>
            message.fromUsername === "operatorbot" &&
            message.subject === mailSubject &&
            message.body === mailBody,
        ) ?? false,
    );
    expect(peerMail.success).toBe(true);

    const costs = await apiRequest<CostsHistogramResponse>(
      cookie,
      "GET",
      `/costs?start=${encodeURIComponent(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      )}&end=${encodeURIComponent(new Date().toISOString())}&bucketHours=1&leadUsername=operatorbot`,
    );
    expect(Array.isArray(costs.buckets)).toBe(true);
    expect(Array.isArray(costs.byAgent)).toBe(true);

    const hostRuns = await apiRequest<RunsDataResponse>(
      cookie,
      "GET",
      `/hosts/${HOSTNAME}/runs?count=5`,
    );
    expect(
      hostRuns.data?.runs.some((item) => item.username === "operatorbot"),
    ).toBe(true);

    const archiveChat = await apiRequest<ArchiveChatResponse>(
      cookie,
      "POST",
      "/agents/peerbot/chat/archive",
    );
    expect(archiveChat.success).toBe(true);
    expect(archiveChat.archivedCount).toBeGreaterThanOrEqual(1);

    const archiveMail = await apiRequest<ArchiveMailResponse>(
      cookie,
      "POST",
      "/agents/peerbot/mail/archive",
    );
    expect(archiveMail.success).toBe(true);
    expect(archiveMail.archivedCount).toBeGreaterThanOrEqual(1);

    const stop = await apiRequest<AgentStopResult>(
      cookie,
      "POST",
      "/agents/operatorbot/stop",
      { recursive: false },
    );
    expect(stop.success).toBe(true);
  });
});
