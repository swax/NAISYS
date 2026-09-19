import { expect, test, vi } from "vitest";

import { createChatService } from "../../mail/chat.js";
import { createMockRunService, createMockShellWrapper } from "../mocks.js";

test("incremental chat keeps ascending order and returns a cursor without dropping a full page", async () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    id: i + 11,
    body: `message-${i + 11}`,
    createdAt: "2026-09-19T08:00:00Z",
    fromUsername: "sam",
    fromTitle: "Technician",
    recipientUsernames: ["nick"],
    isUnread: true,
  }));
  const sendRequest = vi.fn().mockResolvedValue({ success: true, messages });
  const service = createChatService(
    {
      sendRequest,
      registerEvent: vi.fn(),
      unregisterEvent: vi.fn(),
      getHubUrl: () => "https://example.test/hub",
    } as never,
    { resolveUsernames: () => [{ userId: 2 }] } as never,
    1,
    {} as never,
    {} as never,
    createMockShellWrapper(),
    createMockRunService(),
  );
  const text = await service.handleCommand('since 10 "sam"');
  if (typeof text !== "string") throw new Error("Expected chat text");
  expect(sendRequest).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ afterId: 10, take: 20, withUserIds: [2] }),
  );
  expect(text.indexOf("message-11")).toBeLessThan(text.indexOf("message-30"));
  expect(text).toContain("ns-chat since 30");
  await expect(service.handleCommand("since invalid")).rejects.toContain(
    "Usage:",
  );
});
