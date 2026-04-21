import { HubEvents } from "@naisys/hub-protocol";
import table from "text-table";

import type { HubClient } from "../hub/hubClient.js";

export function createMailQueryService(
  hubClient: HubClient,
  localUserId: number,
) {
  async function listMessages(filter: "received" | "sent"): Promise<string> {
    const response = await hubClient.sendRequest(HubEvents.MAIL_LIST, {
      userId: localUserId,
      filter,
      kind: "mail",
    });

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
    const response = await hubClient.sendRequest(HubEvents.MAIL_SEARCH, {
      userId: localUserId,
      terms: searchTerm,
      includeArchived,
      subjectOnly,
    });

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

export type MailQueryService = ReturnType<typeof createMailQueryService>;
