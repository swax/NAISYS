/**
 * Hub attachments + wake-on-message E2E.
 *
 *  1. Boot integrated hub + supervisor with three agents:
 *     sender, receiver (wakeOnMessage), observer.
 *  2. Start only `sender`; leave `receiver` and `observer` stopped.
 *  3. Login to the supervisor API as superadmin.
 *  4. Send mail from sender → receiver via supervisor multipart, with a
 *     small text attachment.
 *  5. Assert the message + attachment metadata appear in the supervisor
 *     mail API and the attachment download URL serves the original bytes.
 *  6. Assert `receiver` auto-starts because mail arrived for a stopped agent.
 *  7. Switch the NAISYS CLI to receiver and read the mail.
 *  8. Send chat from receiver → observer via the CLI with a file attachment.
 *  9. Assert `observer` auto-starts and the conversation + attachment are
 *     visible through the supervisor chat API (download URL works too).
 * 10. Archive the mail through the CLI and the chat through the supervisor
 *     API, then assert archived state via the supervisor mail/chat APIs.
 */

import { sleep } from "@naisys/common";
import type {
  AgentDetailResponse,
  AgentListResponse,
  ArchiveChatResponse,
  ChatConversationsResponse,
  ChatMessagesResponse,
  MailDataResponse,
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
import { loginAsSuperAdmin, waitFor } from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 180000 });

describe("Hub Attachments and Wake-on-Message E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const SERVER_PORT = 4421;
  const HOSTNAME = "TEST-HUB-ATTACH-WAKE";
  const API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;

  beforeEach(() => {
    testDir = getTestDir("hub_attachments_wake");
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

  test("attachments flow + receiver auto-starts when mail arrives", async () => {
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "sender.yaml", {
      username: "sender",
      title: "Sender Bot",
      mailEnabled: true,
      chatEnabled: true,
    });
    createAgentYaml(testDir, "receiver.yaml", {
      username: "receiver",
      title: "Receiver Bot",
      mailEnabled: true,
      chatEnabled: true,
      wakeOnMessage: true,
    });
    createAgentYaml(testDir, "observer.yaml", {
      username: "observer",
      title: "Observer Bot",
      mailEnabled: true,
      chatEnabled: true,
    });

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", testDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    // Wait for the implicit admin agent to start, leaving us at a CLI prompt.
    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    const api = await loginAsSuperAdmin(naisys, API_BASE);

    const agents = await api.get<AgentListResponse>("/agents");
    const sender = agents.items.find((a) => a.name === "sender");
    const receiver = agents.items.find((a) => a.name === "receiver");
    const observer = agents.items.find((a) => a.name === "observer");
    expect(sender).toBeDefined();
    expect(receiver).toBeDefined();
    expect(observer).toBeDefined();

    // --- Start sender via CLI; leave receiver and observer stopped. ---
    await naisys.startAgent("sender", "hub attachments wake test");

    await waitFor(
      "sender to become active",
      () => api.get<AgentDetailResponse>("/agents/sender"),
      (agent) => agent.status === "active",
    );

    const receiverPre = await api.get<AgentDetailResponse>("/agents/receiver");
    expect(receiverPre.status).not.toBe("active");
    const observerPre = await api.get<AgentDetailResponse>("/agents/observer");
    expect(observerPre.status).not.toBe("active");

    // --- Send mail (multipart with attachment) from sender to receiver ---
    const attachmentText = "wake-on-message attachment payload";
    const attachmentName = "wake.txt";
    const subject = "Wake test mail";
    const body = "Body of wake-on-message mail";

    const mailForm = new FormData();
    mailForm.append("fromId", String(sender!.id));
    mailForm.append("toIds", JSON.stringify([receiver!.id]));
    mailForm.append("subject", subject);
    mailForm.append("message", body);
    mailForm.append(
      "attachments",
      new Blob([attachmentText], { type: "text/plain" }),
      attachmentName,
    );

    const sendResult = await api.postMultipart<SendMailResponse>(
      "/agents/sender/mail",
      mailForm,
    );
    expect(sendResult.success).toBe(true);

    // --- Verify the message + attachment metadata via supervisor API ---
    const receiverMail = await waitFor(
      "receiver mail to include the attachment",
      () => api.get<MailDataResponse>("/agents/receiver/mail?count=10"),
      (response) =>
        response.data?.mail.some(
          (m) =>
            m.subject === subject &&
            m.fromUsername === "sender" &&
            (m.attachments?.some((a) => a.filename === attachmentName) ??
              false),
        ) ?? false,
    );
    const mailMessage = receiverMail.data!.mail.find(
      (m) => m.subject === subject,
    )!;
    expect(mailMessage.body).toBe(body);
    const mailAttachment = mailMessage.attachments![0];
    expect(mailAttachment.filename).toBe(attachmentName);
    expect(mailAttachment.fileSize).toBe(
      Buffer.byteLength(attachmentText, "utf8"),
    );

    // Download URL works and serves the original bytes.
    const mailDownload = await api.fetchFromHost(mailAttachment.downloadUrl);
    expect(mailDownload.status).toBe(200);
    const mailDownloadText = await mailDownload.text();
    expect(mailDownloadText).toBe(attachmentText);

    // --- Receiver should auto-start because mail arrived for a stopped agent ---
    await waitFor(
      "receiver to become active after mail arrives",
      () => api.get<AgentDetailResponse>("/agents/receiver"),
      (agent) => agent.status === "active",
      60000,
    );

    // --- Switch CLI to receiver and read the mail ---
    await naisys.switchAgent("receiver");

    const inboxOutput = await naisys.runCommand("ns-mail inbox", {
      waitFor: "sender",
      timeoutMs: 15000,
    });
    expect(inboxOutput).toContain(subject);

    const idMatch = inboxOutput.match(/\|\s*(\d+)\s*\|\s*sender/i);
    expect(idMatch).not.toBeNull();
    const mailId = idMatch![1];

    const readOutput = await naisys.readMail(mailId);
    expect(readOutput).toContain(body);
    expect(readOutput).toContain(attachmentName);

    // --- Send chat with attachment from receiver to observer via CLI ---
    const chatAttachmentText = "chat attachment from receiver";
    const chatAttachmentName = "chatfile.txt";
    const chatAttachmentPath = join(testDir, chatAttachmentName);
    writeFileSync(chatAttachmentPath, chatAttachmentText);
    const chatBody = "Hello observer with attachment";

    const chatOutput = await naisys.runCommand(
      `ns-chat send "observer" "${chatBody}" ${chatAttachmentPath}`,
      { waitFor: "Chat sent", timeoutMs: 15000 },
    );
    expect(chatOutput).toContain("Chat sent");

    // Chat message should auto-start observer too (unread mail/chat triggers it).
    await waitFor(
      "observer to become active after chat arrives",
      () => api.get<AgentDetailResponse>("/agents/observer"),
      (agent) => agent.status === "active",
      60000,
    );

    // --- Verify chat conversation + attachment via supervisor API ---
    const observerChat = await waitFor(
      "observer chat conversation with receiver",
      () => api.get<ChatConversationsResponse>("/agents/observer/chat"),
      (response) =>
        response.conversations.some(
          (c) =>
            c.participants.includes("observer") &&
            c.participants.includes("receiver"),
        ),
    );
    const conversation = observerChat.conversations.find(
      (c) =>
        c.participants.includes("observer") &&
        c.participants.includes("receiver"),
    )!;
    expect(conversation.lastMessage).toBe(chatBody);
    expect(conversation.isArchived).toBe(false);

    const chatMessages = await api.get<ChatMessagesResponse>(
      `/agents/observer/chat/${conversation.participants}`,
    );
    const chatMessage = chatMessages.messages.find(
      (m) => m.body === chatBody && m.fromUsername === "receiver",
    );
    expect(chatMessage).toBeDefined();
    expect(chatMessage!.attachments?.[0].filename).toBe(chatAttachmentName);
    expect(chatMessage!.attachments?.[0].fileSize).toBe(
      Buffer.byteLength(chatAttachmentText, "utf8"),
    );

    const chatDownload = await api.fetchFromHost(
      chatMessage!.attachments![0].downloadUrl,
    );
    expect(chatDownload.status).toBe(200);
    expect(await chatDownload.text()).toBe(chatAttachmentText);

    // --- Archive the mail through the NAISYS CLI (still on receiver) ---
    const archiveMailOutput = await naisys.runCommand(
      `ns-mail archive ${mailId}`,
      { waitFor: "archived", timeoutMs: 10000 },
    );
    expect(archiveMailOutput).toContain("archived");

    // Receiver's recipient row should now have archivedAt populated.
    const receiverMailAfter = await waitFor(
      "receiver mail to show archived state",
      () => api.get<MailDataResponse>("/agents/receiver/mail?count=10"),
      (response) =>
        response.data?.mail.some(
          (m) =>
            m.subject === subject &&
            m.recipients.some(
              (r) => r.username === "receiver" && r.archivedAt !== null,
            ),
        ) ?? false,
    );
    expect(receiverMailAfter.success).toBe(true);

    // --- Archive the chat for observer via supervisor API ---
    const archiveChat = await api.post<ArchiveChatResponse>(
      "/agents/observer/chat/archive",
    );
    expect(archiveChat.success).toBe(true);
    expect(archiveChat.archivedCount).toBeGreaterThanOrEqual(1);

    const observerChatAfter = await api.get<ChatConversationsResponse>(
      "/agents/observer/chat",
    );
    const archivedConversation = observerChatAfter.conversations.find(
      (c) => c.participants === conversation.participants,
    );
    expect(archivedConversation?.isArchived).toBe(true);

    naisys.dumpStderrIfAny("Integrated NAISYS");
  });
});
