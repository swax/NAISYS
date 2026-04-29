import type { MailMessageData, MailReceivedPush } from "@naisys/hub-protocol";
import { HubEvents } from "@naisys/hub-protocol";
import stringArgv from "string-argv";

import type { IAgentManager } from "../agent/agentManagerInterface.js";
import type { UserEntry } from "../agent/userService.js";
import type { UserService } from "../agent/userService.js";
import { mailCmd } from "../command/commandDefs.js";
import type {
  CommandResponse,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import type { ShellWrapper } from "../command/shellWrapper.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { AttachmentService } from "../services/attachmentService.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import type { MailContent } from "./mailFormat.js";
import { formatMessageDisplay } from "./mailFormat.js";
import type { MailQueryService } from "./mailQueryService.js";

export function createMailService(
  hubClient: HubClient | undefined,
  userService: UserService,
  mailQueryService: MailQueryService | null,
  localUserId: number,
  promptNotification: PromptNotificationService,
  attachmentService: AttachmentService,
  shellWrapper: ShellWrapper,
  globalConfig: GlobalConfig,
  agentManager: IAgentManager,
) {
  const localUser = userService.getUserById(localUserId);
  const localUsername = localUser?.username || "unknown";
  const localTitle = localUser?.config.title || "";

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);
    const subs = mailCmd.subcommands!;
    const usageError = (sub: keyof typeof subs) =>
      `Invalid parameters. Usage: ${mailCmd.name} ${subs[sub].usage}`;

    if (!argv[0]) {
      argv[0] = "help";
    }

    switch (argv[0]) {
      case "help": {
        const lines = [`${mailCmd.name} <command>`];
        lines.push(`  ${subs.send.usage.padEnd(40)}${subs.send.description}`);
        if (hubClient) {
          lines.push(
            `  ${subs.inbox.usage.padEnd(40)}${subs.inbox.description}`,
            `  ${subs.outbox.usage.padEnd(40)}${subs.outbox.description}`,
            `  ${subs.read.usage.padEnd(40)}${subs.read.description}`,
            `  ${subs.archive.usage.padEnd(40)}${subs.archive.description}`,
            `  ${subs.search.usage.padEnd(40)}${subs.search.description}`,
          );
        }
        return lines.join("\n");
      }

      case "inbox": {
        if (!mailQueryService) {
          throw "Not available in local mode.";
        }
        return mailQueryService.listMessages("received");
      }

      case "outbox": {
        if (!mailQueryService) {
          throw "Not available in local mode.";
        }
        return mailQueryService.listMessages("sent");
      }

      case "send": {
        // Expected: ns-mail send "user1,user2" "subject" "message" [file1 file2 ...]
        if (!argv[1] || !argv[2] || !argv[3]) {
          throw usageError("send");
        }

        const recipients = userService.resolveUsernames(argv[1]);

        // Upload any file attachments (argv[4+])
        let attachmentIds: number[] | undefined;
        let resolvedPaths: string[] | undefined;
        const filePaths = argv.slice(4);
        if (filePaths.length > 0) {
          resolvedPaths = await shellWrapper.resolvePaths(filePaths);
          if (hubClient) {
            attachmentIds = await attachmentService.uploadAll(
              resolvedPaths,
              "mail",
            );
          }
        }

        return sendMessage(
          recipients,
          argv[2],
          argv[3],
          attachmentIds,
          resolvedPaths,
        );
      }

      case "read": {
        if (!hubClient) {
          throw "Not available in local mode.";
        }
        const messageId = parseInt(argv[1]);
        if (isNaN(messageId)) {
          throw usageError("read");
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
          throw usageError("archive");
        }
        return archiveMessages(messageIds);
      }

      case "search": {
        if (!mailQueryService) {
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
          throw usageError("search");
        }

        return mailQueryService.searchMessages(
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
        return `Unknown ${mailCmd.name} subcommand '${argv[0]}'. See valid commands below:\n${helpContent}`;
      }
    }
  }

  async function sendMessage(
    recipients: UserEntry[],
    subject: string,
    message: string,
    attachmentIds?: number[],
    resolvedPaths?: string[],
  ): Promise<string> {
    if (recipients.length === 0) {
      throw "No recipients";
    }

    message = message.replace(/\\n/g, "\n");

    // Ephemerals always go local; the hub doesn't know about them.
    const localRecipients = hubClient
      ? recipients.filter((r) => r.isEphemeral)
      : recipients;
    const hubRecipients = hubClient
      ? recipients.filter((r) => !r.isEphemeral)
      : [];

    if (hubRecipients.length > 0) {
      const response = await hubClient!.sendRequest(HubEvents.MAIL_SEND, {
        fromUserId: localUserId,
        toUserIds: hubRecipients.map((r) => r.userId),
        subject,
        body: message,
        kind: "mail",
        attachmentIds,
      });

      if (!response.success) {
        throw response.error || "Failed to send message";
      }
    }

    if (localRecipients.length > 0) {
      const mailContent: MailContent = {
        fromUsername: localUsername,
        fromTitle: localTitle,
        recipientUsernames: localRecipients.map((r) => r.username),
        subject,
        body: message,
        createdAt: new Date().toISOString(),
        filePaths: resolvedPaths,
      };

      const display = formatMessageDisplay(mailContent);

      for (const recipient of localRecipients) {
        promptNotification.notify({
          userId: recipient.userId,
          wake: "yes",
          contextOutput: ["New Message:", display],
        });
      }

      // Auto-start is local-mode only — ephemerals start via `ns-agent create`.
      if (!hubClient && globalConfig.globalConfig().autoStartAgentsOnMessage) {
        const runningUserIds = new Set(
          agentManager.runningAgents.map((a) => a.agentUserId),
        );
        for (const recipient of localRecipients) {
          if (
            recipient.userId !== localUserId &&
            !recipient.isEphemeral &&
            !runningUserIds.has(recipient.userId)
          ) {
            agentManager.startAgent(recipient.userId).catch(() => {});
          }
        }
      }
    }

    return "Mail sent";
  }

  async function archiveMessages(messageIds: number[]): Promise<string> {
    if (!hubClient) throw "Not available in local mode.";
    const response = await hubClient.sendRequest(HubEvents.MAIL_ARCHIVE, {
      userId: localUserId,
      messageIds,
    });

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

    const response = await hubClient.sendRequest(HubEvents.MAIL_UNREAD, {
      userId: localUserId,
      kind: "mail",
      afterId: lastUnreadId,
    });

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
    const response = await hubClient!.sendRequest(HubEvents.MAIL_PEEK, {
      userId: localUserId,
      messageId,
    });

    if (!response.success || !response.message) {
      throw response.error || "Failed to read message";
    }

    return response.message;
  }

  async function markMessagesRead(messageIds: number[]): Promise<void> {
    if (!hubClient || !messageIds.length) return;

    await hubClient.sendRequest(HubEvents.MAIL_MARK_READ, {
      userId: localUserId,
      messageIds,
      kind: "mail",
    });
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
    const mailReceivedHandler = (data: MailReceivedPush) => {
      if (data.kind !== "mail") return;
      if (data.recipientUserIds.includes(localUserId)) {
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
