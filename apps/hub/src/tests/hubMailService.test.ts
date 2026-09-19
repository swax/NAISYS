import { HubEvents } from "@naisys/hub-protocol";
import { expect, test, vi } from "vitest";

import { createHubMailService } from "../mail/hubMailService.js";

test("only supervisors can submit durable retry messages; incremental reads use ascending IDs", async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const sendMail = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const service = createHubMailService(
    {
      registerEvent: (event: string, handler: any) =>
        handlers.set(event, handler),
      unregisterEvent: vi.fn(),
      getSupervisorConnections: () => [{ getHostId: () => 99 }],
    } as never,
    {
      hubDb: {
        mail_messages: { findMany },
        mail_recipients: { findMany: vi.fn().mockResolvedValue([]) },
      },
    } as never,
    { log: vi.fn(), error: vi.fn() } as never,
    { getActiveUserIds: () => new Set() } as never,
    { sendMail } as never,
    {} as never,
    {} as never,
    {
      getConfig: () => ({
        success: true,
        config: { autoStartAgentsOnMessage: true },
      }),
    } as never,
  );
  try {
    const message = {
      fromUserId: 1,
      toUserIds: [7],
      subject: "",
      body: "retry",
      kind: "chat",
      deliveryKey: "erp-retry:manager:80:deadline",
    };
    const ack = vi.fn();
    await handlers.get(HubEvents.MAIL_SEND)!(2, message, ack);
    expect(ack).toHaveBeenLastCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(sendMail).not.toHaveBeenCalled();
    await handlers.get(HubEvents.MAIL_SEND)!(99, message, ack);
    expect(ack).toHaveBeenLastCalledWith({ success: true });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        source: message.deliveryKey,
        deduplicate: true,
      }),
    );
    await handlers.get(HubEvents.MAIL_LIST)!(
      2,
      { userId: 7, kind: "chat", afterId: 10, take: 20 },
      ack,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 10 } }),
        orderBy: { id: "asc" },
        take: 20,
      }),
    );
  } finally {
    service.cleanup();
  }
});
