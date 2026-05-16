import type { MailPush } from "@naisys/hub-protocol";
import { describe, expect, test } from "vitest";

import { chatMessagesRoomKey, imagesFromChatMessage } from "./voiceChatImages";

const message = (overrides: Partial<MailPush> = {}): MailPush => ({
  recipientUserIds: [2],
  fromUserId: 1,
  kind: "chat",
  messageId: 42,
  body: "look at this",
  createdAt: "2026-05-15T12:00:00.000Z",
  participants: "admin,bob",
  ...overrides,
});

describe("chatMessagesRoomKey", () => {
  test("sorts participants and joins with the chat-messages prefix", () => {
    expect(chatMessagesRoomKey(["bob", "admin"])).toBe(
      "chat-messages:admin,bob",
    );
  });

  test("deduplicates and ignores empty entries", () => {
    expect(chatMessagesRoomKey(["bob", "", "admin", "bob"])).toBe(
      "chat-messages:admin,bob",
    );
  });
});

describe("imagesFromChatMessage", () => {
  test("synthesizes one entry per image attachment", () => {
    const entries = imagesFromChatMessage(
      message({
        attachments: [
          { id: "att-1", filename: "shot.png", fileSize: 2048 },
          { id: "att-2", filename: "page.pdf", fileSize: 4096 },
          { id: "att-3", filename: "fix.jpg", fileSize: 1024 },
        ],
      }),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      attachmentId: "att-1",
      attachmentFilename: "shot.png",
      attachmentFileSize: 2048,
      source: null,
      message: "[chat attachment: shot.png]",
    });
    expect(entries[1]).toMatchObject({
      attachmentId: "att-3",
      attachmentFilename: "fix.jpg",
    });
  });

  test("returns nothing for messages without attachments", () => {
    expect(imagesFromChatMessage(message())).toEqual([]);
    expect(imagesFromChatMessage(message({ attachments: [] }))).toEqual([]);
  });

  test("ignores non-chat kinds (mail messages share the push shape)", () => {
    expect(
      imagesFromChatMessage(
        message({
          kind: "mail",
          attachments: [{ id: "att-1", filename: "shot.png", fileSize: 1024 }],
        }),
      ),
    ).toEqual([]);
  });

  test("uses unique negative ids per attachment so the buffer doesn't collapse them", () => {
    const entries = imagesFromChatMessage(
      message({
        attachments: [
          { id: "att-1", filename: "a.png", fileSize: 1024 },
          { id: "att-2", filename: "b.png", fileSize: 1024 },
        ],
      }),
    );
    expect(entries[0].id).not.toBe(entries[1].id);
    expect(entries[0].id).toBeLessThan(0);
    expect(entries[1].id).toBeLessThan(0);
  });
});
