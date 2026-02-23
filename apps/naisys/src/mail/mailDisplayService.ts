import {
  HubEvents,
  MailListResponse,
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
  attachments?: { id: number; filename: string; fileSize: number }[];
}

/** Format a byte count into a human-readable size string */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Standard display format for a mail message */
export function formatMessageDisplay(
  content: MailContent,
  hubUrl?: string,
): string {
  let output =
    `  Subject: ${content.subject}\n` +
    `  From: ${content.fromUsername}\n` +
    `  Title: ${content.fromTitle}\n` +
    `  To: ${content.recipientUsernames.join(", ")}\n` +
    `  Date: ${new Date(content.createdAt).toLocaleString()}\n` +
    `  Message:\n` +
    `  ${content.body}`;

  if (content.attachments?.length) {
    output += "\n  Attachments:";
    for (const att of content.attachments) {
      output += `\n    ${att.id}: ${att.filename} (${formatSize(att.fileSize)})`;
    }
    if (hubUrl) {
      output += "\n  Download:";
      for (const att of content.attachments) {
        output += `\n    curl -k "${hubUrl}/attachments/${att.id}?apiKey=$NAISYS_API_KEY" -o ${att.filename}`;
      }
    }
  }

  return output;
}

export function createMailDisplayService(
  hubClient: HubClient,
  localUserId: number,
) {
  async function listMessages(filter?: "received" | "sent"): Promise<string> {
    const response = await hubClient.sendRequest<MailListResponse>(
      HubEvents.MAIL_LIST,
      { userId: localUserId, filter, kind: "mail" },
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
    searchMessages,
  };
}

export type MailDisplayService = ReturnType<typeof createMailDisplayService>;
