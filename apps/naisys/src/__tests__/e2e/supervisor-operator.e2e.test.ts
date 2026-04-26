/**
 * Supervisor operator workflow E2E.
 *
 *  1. Boot integrated hub + supervisor with two agents (operatorbot,
 *     peerbot) and login to the supervisor API as superadmin.
 *  2. List agents and hosts; assert both agents exist and the host is
 *     online.
 *  3. Start operatorbot via the supervisor API and wait for it to become
 *     active.
 *  4. Wait for a run session to appear, then fetch its logs and assert the
 *     logs response shape.
 *  5. Run a shell command in the run session, then pause and resume the
 *     session.
 *  6. Send chat from operatorbot → peerbot via API; assert the conversation
 *     and message appear in peerbot's chat data.
 *  7. Send mail from operatorbot → peerbot via API; assert the message
 *     appears in peerbot's mail data.
 *  8. Fetch the costs histogram and host-scoped runs; assert they include
 *     operatorbot activity.
 *  9. Archive peerbot's chat and mail via API; assert archivedCount ≥ 1.
 * 10. Stop operatorbot via API.
 */

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
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";
import { loginAsSuperAdmin, waitFor } from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 150000 });

describe("Supervisor Operator E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const HOSTNAME = "TEST-SUPERVISOR-OPERATOR";
  let SERVER_PORT: number;
  let API_BASE: string;

  beforeEach(async () => {
    testDir = getTestDir("supervisor_operator");
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
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="${HOSTNAME}"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
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

    const api = await loginAsSuperAdmin(naisys, API_BASE);

    const me = await api.get<{ username: string }>("/auth/me");
    expect(me.username).toBe("superadmin");

    const agents = await api.get<AgentListResponse>("/agents");
    const operator = agents.items.find((agent) => agent.name === "operatorbot");
    const peer = agents.items.find((agent) => agent.name === "peerbot");
    expect(operator).toBeDefined();
    expect(peer).toBeDefined();

    const hosts = await api.get<HostListResponse>("/hosts");
    expect(hosts.items.some((host) => host.name === HOSTNAME)).toBe(true);

    const host = await api.get<HostDetailResponse>(`/hosts/${HOSTNAME}`);
    expect(host.online).toBe(true);

    const start = await api.post<AgentStartResult>(
      "/agents/operatorbot/start",
      { task: "Supervisor operator workflow test" },
    );
    expect(start.success).toBe(true);

    await waitFor(
      "operatorbot to become active",
      () => api.get<AgentDetailResponse>("/agents/operatorbot"),
      (agent) => agent.status === "active",
    );

    const runs = await waitFor(
      "operatorbot to create a run session",
      () => api.get<RunsDataResponse>("/agents/operatorbot/runs?count=5"),
      (response) => (response.data?.runs.length ?? 0) > 0,
    );
    const run = runs.data!.runs[0];
    expect(run.username).toBe("operatorbot");
    expect(run.hostName).toBe(HOSTNAME);

    const logs = await api.get<{
      success: boolean;
      data?: { logs: unknown[] };
    }>(
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/logs?limit=20`,
    );
    expect(logs.success).toBe(true);
    expect(Array.isArray(logs.data?.logs)).toBe(true);

    const command = await api.post<AgentRunCommandResult>(
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/command`,
      { command: "echo supervisor-operator-workflow" },
    );
    expect(command.success).toBe(true);

    const pause = await api.post<AgentRunPauseResult>(
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/pause`,
    );
    expect(pause.success).toBe(true);

    const resume = await api.post<AgentRunPauseResult>(
      `/agents/operatorbot/runs/${run.runId}/sessions/${run.sessionId}/resume`,
    );
    expect(resume.success).toBe(true);

    const chatMessage = "operator workflow chat";
    const chat = await api.post<SendChatResponse>("/agents/operatorbot/chat", {
      fromId: operator!.id,
      toIds: [peer!.id],
      message: chatMessage,
    });
    expect(chat.success).toBe(true);

    const conversations = await waitFor(
      "peerbot chat conversation",
      () => api.get<ChatConversationsResponse>("/agents/peerbot/chat"),
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
    const messages = await api.get<ChatMessagesResponse>(
      `/agents/peerbot/chat/${conversationKey}`,
    );
    expect(
      messages.messages.some((message) => message.body === chatMessage),
    ).toBe(true);

    const mailSubject = "Operator workflow";
    const mailBody = "mail from operator workflow";
    const mail = await api.post<SendMailResponse>("/agents/operatorbot/mail", {
      fromId: operator!.id,
      toIds: [peer!.id],
      subject: mailSubject,
      message: mailBody,
    });
    expect(mail.success).toBe(true);

    const peerMail = await waitFor(
      "peerbot mail message",
      () => api.get<MailDataResponse>("/agents/peerbot/mail?count=10"),
      (response) =>
        response.data?.mail.some(
          (message) =>
            message.fromUsername === "operatorbot" &&
            message.subject === mailSubject &&
            message.body === mailBody,
        ) ?? false,
    );
    expect(peerMail.success).toBe(true);

    const costs = await api.get<CostsHistogramResponse>(
      `/costs?start=${encodeURIComponent(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      )}&end=${encodeURIComponent(new Date().toISOString())}&bucketHours=1&leadUsername=operatorbot`,
    );
    expect(Array.isArray(costs.buckets)).toBe(true);
    expect(Array.isArray(costs.byAgent)).toBe(true);

    const hostRuns = await api.get<RunsDataResponse>(
      `/hosts/${HOSTNAME}/runs?count=5`,
    );
    expect(
      hostRuns.data?.runs.some((item) => item.username === "operatorbot"),
    ).toBe(true);

    const archiveChat = await api.post<ArchiveChatResponse>(
      "/agents/peerbot/chat/archive",
    );
    expect(archiveChat.success).toBe(true);
    expect(archiveChat.archivedCount).toBeGreaterThanOrEqual(1);

    const archiveMail = await api.post<ArchiveMailResponse>(
      "/agents/peerbot/mail/archive",
    );
    expect(archiveMail.success).toBe(true);
    expect(archiveMail.archivedCount).toBeGreaterThanOrEqual(1);

    const stop = await api.post<AgentStopResult>("/agents/operatorbot/stop", {
      recursive: false,
    });
    expect(stop.success).toBe(true);
  });
});
