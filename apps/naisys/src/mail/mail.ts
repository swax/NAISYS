import {
  HubEvents,
  MailArchiveResponse,
  MailMarkReadResponse,
  MailMessageData,
  MailPeekResponse,
  MailReceivedPush,
  MailSendResponse,
  MailUnreadResponse,
} from "@naisys/hub-protocol";
import stringArgv from "string-argv";

import { UserEntry, UserService } from "../agent/userService.js";
import { mailCmd } from "../command/commandDefs.js";
import {
  CommandResponse,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { HubClient } from "../hub/hubClient.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { MailAttachmentService } from "./mailAttachmentService.js";
import {
  formatMessageDisplay,
  MailContent,
  MailDisplayService,
} from "./mailDisplayService.js";

export function createMailService(
  hubClient: HubClient | undefined,
  userService: UserService,
  mailDisplayService: MailDisplayService | null,
  localUserId: number,
  promptNotification: PromptNotificationService,
  attachmentService: MailAttachmentService,
) {
  const localUser = userService.getUserById(localUserId);
  const localUsername = localUser?.username || "unknown";
  const localTitle = localUser?.config.title || "";

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    switch (argv[0]) {
      case "help": {
        const subs = mailCmd.subcommands!;
        const lines = [`${mailCmd.name} <command>`];
        lines.push(`  ${subs.send.usage.padEnd(40)}${subs.send.description}`);
        if (hubClient) {
          lines.push(
            `  ${subs.list.usage.padEnd(40)}${subs.list.description}`,
            `  ${subs.read.usage.padEnd(40)}${subs.read.description}`,
            `  ${subs.archive.usage.padEnd(40)}${subs.archive.description}`,
            `  ${subs.search.usage.padEnd(40)}${subs.search.description}`,
          );
        }
        return lines.join("\n");
      }

      case "list": {
        if (!hubClient || !mailDisplayService) {
          throw "Not available in local mode.";
        }
        const filterArg = argv[1]?.toLowerCase();
        if (filterArg && filterArg !== "received" && filterArg !== "sent") {
          throw "Invalid parameter. Use 'received' or 'sent' to filter, or omit for all messages.";
        }
        return mailDisplayService.listMessages(
          filterArg as "received" | "sent" | undefined,
        );
      }

      case "send": {
        // Expected: ns-mail send "user1,user2" "subject" "message" [file1 file2 ...]
        if (!argv[1] || !argv[2] || !argv[3]) {
          throw "Invalid parameters. There should be a username, subject and message. All contained in quotes.";
        }

        const recipients = userService.resolveUsernames(argv[1]);

        // Upload any file attachments (argv[4+])
        let attachmentIds: number[] | undefined;
        const filePaths = argv.slice(4);
        if (filePaths.length > 0) {
          attachmentIds = await attachmentService.resolveAndUpload(filePaths);
        }

        return sendMessage(recipients, argv[2], argv[3], attachmentIds);
      }

      case "read": {
        if (!hubClient) {
          throw "Not available in local mode.";
        }
        const messageId = parseInt(argv[1]);
        if (isNaN(messageId)) {
          throw "Invalid parameters. Please provide a message id.";
        }
        const msg = await peekMessage(messageId);
        await markMessagesRead([msg.id]);
        return formatMessageDisplay(msg, hubClient.getHubUrl());
      }

      case "archive": {
        if (!hubClient) {
          throw "Not available in local mode.";
        }
        const messageIds = argv[1]?.split(",").map((id) => parseInt(id.trim()));
        if (!messageIds || messageIds.length === 0 || messageIds.some(isNaN)) {
          throw "Invalid parameters. Please provide comma-separated message ids.";
        }
        return archiveMessages(messageIds);
      }

      case "search": {
        if (!hubClient || !mailDisplayService) {
          throw "Not available in local mode.";
        }
        // Parse flags and search term
        const searchArgs = argv.slice(1);
        let includeArchived = false;
        let subjectOnly = false;
        const terms: string[] = [];

        for (const arg of searchArgs) {
          if (arg === "-archived") {
            includeArchived = true;
          } else if (arg === "-subject") {
            subjectOnly = true;
          } else {
            terms.push(arg);
          }
        }

        if (terms.length === 0) {
          throw "Invalid parameters. Please provide search terms.";
        }

        return mailDisplayService.searchMessages(
          terms.join(" "),
          includeArchived,
          subjectOnly,
        );
      }

      default: {
        const helpResponse = await handleCommand("help");
        const helpContent =
          typeof helpResponse === "string"
            ? helpResponse
            : helpResponse.content;
        return (
          "Error, unknown command. See valid commands below:\n" + helpContent
        );
      }
    }
  }

  async function sendMessage(
    recipients: UserEntry[],
    subject: string,
    message: string,
    attachmentIds?: number[],
  ): Promise<string> {
    message = message.replace(/\\n/g, "\n");

    if (hubClient) {
      const response = await hubClient.sendRequest<MailSendResponse>(
        HubEvents.MAIL_SEND,
        {
          fromUserId: localUserId,
          toUserIds: recipients.map((r) => r.userId),
          subject,
          body: message,
          kind: "mail",
          attachmentIds,
        },
      );

      if (!response.success) {
        throw response.error || "Failed to send message";
      }

      return "Mail sent";
    }

    // Local mode: emit to event bus

    const mailContent: MailContent = {
      fromUsername: localUsername,
      fromTitle: localTitle,
      recipientUsernames: recipients.map((r) => r.username),
      subject,
      body: message,
      createdAt: new Date().toISOString(),
    };

    const display = formatMessageDisplay(mailContent);

    for (const recipient of recipients) {
      promptNotification.notify({
        userId: recipient.userId,
        wake: "yes",
        contextOutput: ["New Message:", display],
      });
    }

    return "Mail sent";
  }

  async function archiveMessages(messageIds: number[]): Promise<string> {
    if (!hubClient) throw "Not available in local mode.";
    const response = await hubClient.sendRequest<MailArchiveResponse>(
      HubEvents.MAIL_ARCHIVE,
      { userId: localUserId, messageIds },
    );

    if (!response.success) {
      throw response.error || "Failed to archive messages";
    }

    return `Messages ${messageIds.join(",")} archived`;
  }

  function getAllUserNames(): string[] {
    return userService.getUsers().map((u) => u.username);
  }

  function hasMultipleUsers(): boolean {
    return userService.getUsers().length > 1;
  }

  /** Highest message ID we've seen from MAIL_UNREAD, used as cursor */
  let lastUnreadId = 0;

  async function getUnreadMessages(): Promise<MailMessageData[]> {
    if (!hubClient) {
      return [];
    }

    const response = await hubClient.sendRequest<MailUnreadResponse>(
      HubEvents.MAIL_UNREAD,
      { userId: localUserId, kind: "mail", afterId: lastUnreadId },
    );

    if (!response.success || !response.messages?.length) {
      return [];
    }

    // Advance cursor to max returned ID
    for (const m of response.messages) {
      if (m.id > lastUnreadId) {
        lastUnreadId = m.id;
      }
    }

    return response.messages;
  }

  async function peekMessage(messageId: number): Promise<MailMessageData> {
    const response = await hubClient!.sendRequest<MailPeekResponse>(
      HubEvents.MAIL_PEEK,
      { userId: localUserId, messageId },
    );

    if (!response.success || !response.message) {
      throw response.error || "Failed to read message";
    }

    return response.message;
  }

  async function markMessagesRead(messageIds: number[]): Promise<void> {
    if (!hubClient || !messageIds.length) return;

    await hubClient.sendRequest<MailMarkReadResponse>(
      HubEvents.MAIL_MARK_READ,
      { userId: localUserId, messageIds },
    );
  }

  /**
   * Check for new mail and create a notification if there are unread messages.
   * Uses afterId cursor to avoid duplicate notifications.
   * (Hub mode only)
   */
  async function checkAndNotify(): Promise<void> {
    if (!hubClient) return;

    const messages = await getUnreadMessages();
    if (!messages.length) return;

    const messageIds = messages.map((m) => m.id);

    const contextOutput = messages.flatMap((m) => [
      "New Message:",
      formatMessageDisplay(m, hubClient?.getHubUrl()),
    ]);

    promptNotification.notify({
      userId: localUserId,
      wake: "yes",
      contextOutput,
      processed: () => markMessagesRead(messageIds),
    });
  }

  // Set up notification listeners based on mode
  let cleanupFn: () => void;

  if (hubClient) {
    // Hub mode: listen for MAIL_RECEIVED push from hub
    const mailReceivedHandler = (data: unknown) => {
      const push = data as MailReceivedPush;
      if (push.kind !== "mail") return;
      if (push.recipientUserIds.includes(localUserId)) {
        void checkAndNotify();
      }
    };
    hubClient.registerEvent(HubEvents.MAIL_RECEIVED, mailReceivedHandler);

    cleanupFn = () => {
      hubClient.unregisterEvent(HubEvents.MAIL_RECEIVED, mailReceivedHandler);
    };
  } else {
    // Local mode: notifications carry contextOutput directly, no setup needed
    cleanupFn = () => {};
  }

  function cleanup() {
    cleanupFn();
  }

  const registrableCommand: RegistrableCommand = {
    command: mailCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    getUnreadMessages,
    sendMessage,
    getAllUserNames,
    hasMultipleUsers,
    checkAndNotify,
    cleanup,
  };
}

export type MailService = ReturnType<typeof createMailService>;
