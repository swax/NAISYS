import type { HubDatabaseService } from "@naisys/hub-database";
import { expect, test, vi } from "vitest";

import { createHubSendMailService } from "../mail/hubSendMailService.js";

test("a retried ERP delivery creates one chat and never moves notifications backwards", async () => {
  let row: unknown;
  const messages = {
    findFirst: vi.fn(() => Promise.resolve(row)),
    create: vi.fn(({ data }) => {
      row = { id: 15, ...data };
      return Promise.resolve(row);
    }),
  };
  const recipients = { createMany: vi.fn(), create: vi.fn() };
  const notifications = { updateMany: vi.fn() };
  const db = {
    users: {
      findMany: vi.fn().mockResolvedValue([
        { username: "admin" },
        { username: "nick" },
      ]),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        mail_messages: messages,
        mail_recipients: recipients,
        user_notifications: notifications,
      }),
  };
  const server = { broadcastToSupervisors: vi.fn(), sendMessage: vi.fn() };
  const ownership = {
    updateAgentNotification: vi.fn(),
    throttledPushAgentsStatus: vi.fn(),
    findHostsForAgent: () => [],
  };
  const service = createHubSendMailService(
    server as never,
    { hubDb: db } as unknown as HubDatabaseService,
    ownership as never,
    { redact: (s: string) => s } as never,
  );
  const request = {
    fromUserId: 1,
    recipientUserIds: [7],
    subject: "",
    body: "Retry now eligible",
    kind: "chat" as const,
    source: "erp-retry:manager:80:deadline",
    deduplicate: true,
  };
  await service.sendMail(request);
  // The caller lost the first acknowledgement and resends after restart.
  await service.sendMail(request);
  expect(messages.create).toHaveBeenCalledTimes(1);
  expect(recipients.createMany).toHaveBeenCalledTimes(1);
  expect(notifications.updateMany).toHaveBeenCalledTimes(1);
  expect(server.broadcastToSupervisors).toHaveBeenCalledTimes(1);
});
