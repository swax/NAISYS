import type { MailPush } from "@naisys/hub-protocol";

/** Discriminated union for events pushed to mail/chat browser rooms */
export type MessageRoomEvent =
  | ({
      type: "new-message";
      /** ID of the previous message pushed to this room, null if unknown */
      previousMessageId: number | null;
    } & MailPush)
  | { type: "read-receipt"; messageIds: number[]; userId: number };
