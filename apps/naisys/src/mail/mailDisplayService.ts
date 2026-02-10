import {
  HubEvents,
  MailListResponse,
  MailReadResponse,
  MailSearchResponse,
} from "@naisys/hub-protocol";
import table from "text-table";
import { HubClient } from "../hub/hubClient.js";

/** Content carried with mail delivery */
export interface MailContent {
  fromUsername: string;
  fromTitle: string;
  recipientUsernames: string[];
  subject: string;
  body: string;
  createdAt: string;
}

/** Standard display format for a mail message */
export function formatMessageDisplay(content: MailContent): string {
  return (
    `Subject: ${content.subject}\n` +
    `From: ${content.fromUsername}\n` +
    `Title: ${content.fromTitle}\n` +
    `To: ${content.recipientUsernames.join(", ")}\n` +
    `Date: ${new Date(content.createdAt).toLocaleString()}\n` +
    `Message:\n` +
    `${content.body}`
  );
}

export function createMailDisplayService(
  hubClient: HubClient,
  localUserId: number,
) {
  async function listMessages(filter?: "received" | "sent"): Promise<string> {
    const response = await hubClient.sendRequest<MailListResponse>(
      HubEvents.MAIL_LIST,
      { userId: localUserId, filter },
    );

    if (!response.success) {
      throw response.error || "Failed to list messages";
    }

    const messages = response.messages;
    if (!messages || messages.length === 0) {
      return "No messages found.";
    }

    const userHeader = filter === "sent" ? "To" : "From";

    return table(
      [
        ["", "ID", userHeader, "Subject", "Date"],
        ...messages.map((m) => {
          const userColumn =
            filter === "sent"
              ? m.recipientUsernames.join(", ")
              : m.fromUsername;

          return [
            m.isUnread ? "*" : "",
            String(m.id),
            userColumn,
            m.subject.length > 40 ? m.subject.slice(0, 37) + "..." : m.subject,
            new Date(m.createdAt).toLocaleString(),
          ];
        }),
      ],
      { hsep: " | " },
    );
  }

  async function readMessage(
    messageId: number,
  ): Promise<{ fullMessageId: number; display: string }> {
    const response = await hubClient.sendRequest<MailReadResponse>(
      HubEvents.MAIL_READ,
      { userId: localUserId, messageId },
    );

    if (!response.success || !response.message) {
      throw response.error || "Failed to read message";
    }

    const msg = response.message;

    const display = formatMessageDisplay({
      fromUsername: msg.fromUsername,
      fromTitle: msg.fromTitle,
      recipientUsernames: msg.recipientUsernames,
      subject: msg.subject,
      body: msg.body,
      createdAt: msg.createdAt,
    });

    return { fullMessageId: msg.id, display };
  }

  async function searchMessages(
    searchTerm: string,
    includeArchived: boolean,
    subjectOnly: boolean,
  ): Promise<string> {
    const response = await hubClient.sendRequest<MailSearchResponse>(
      HubEvents.MAIL_SEARCH,
      {
        userId: localUserId,
        terms: searchTerm,
        includeArchived,
        subjectOnly,
      },
    );

    if (!response.success) {
      throw response.error || "Failed to search messages";
    }

    const messages = response.messages;
    if (!messages || messages.length === 0) {
      return "No messages found matching search criteria.";
    }

    return table(
      [
        ["ID", "Subject", "From", "Date"],
        ...messages.map((m) => [
          String(m.id),
          m.subject.length > 40 ? m.subject.slice(0, 37) + "..." : m.subject,
          m.fromUsername,
          new Date(m.createdAt).toLocaleString(),
        ]),
      ],
      { hsep: " | " },
    );
  }

  return {
    listMessages,
    readMessage,
    searchMessages,
  };
}

export type MailDisplayService = ReturnType<typeof createMailDisplayService>;
