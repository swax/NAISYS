import {
  HubEvents,
  MailArchiveResponse,
  MailReceivedPush,
  MailSendResponse,
  MailUnreadResponse,
} from "@naisys/hub-protocol";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { UserService } from "../agent/userService.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { MailDisplayService } from "./mailDisplayService.js";
import {
  MailContent,
  emitMailDelivered,
  formatMessageDisplay,
  onMailDelivered,
} from "./mailEventBus.js";

export function createMailService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  hubClient: HubClient | undefined,
  userService: UserService,
  mailDisplayService: MailDisplayService | null,
  localUserId: string,
  promptNotification: PromptNotificationService,
  contextManager: ContextManager,
) {
  const localUser = userService.getUserById(localUserId);
  const localUsername = localUser?.config.username || "unknown";
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
        const lines = [`ns-mail <command>`];
        lines.push(`  send "<users>" "<subject>" "<msg>" Send a message.`);
        if (hubClient) {
          lines.push(
            `  list [received|sent]               List recent messages (non-archived, * = unread)`,
            `  read <id>                          Read a message (marks as read)`,
            `  archive <ids>                      Archive messages (comma-separated)`,
            `  search <terms> [-archived] [-subject] Search messages`,
          );
        }
        lines.push(
          `  wait <seconds>                     Wait for new mail`,
          ``,
          `* Attachments are not supported, use file paths to reference files in emails as all users are usually on the same machine`,
        );
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
        // Expected: ns-mail send "user1,user2" "subject" "message"
        const usernames = argv[1]?.split(",").map((u) => u.trim());
        const subject = argv[2];
        const message = argv[3];

        if (!usernames || !subject || !message) {
          throw "Invalid parameters. There should be a username, subject and message. All contained in quotes.";
        }

        return sendMessage(usernames, subject, message);
      }

      case "wait": {
        const pauseSeconds = argv[1]
          ? parseInt(argv[1])
          : globalConfig().shellCommand.maxTimeoutSeconds;

        return {
          content: `Waiting ${pauseSeconds} seconds for new mail messages...`,
          nextCommandResponse: {
            nextCommandAction: NextCommandAction.Continue,
            pauseSeconds,
            wakeOnMessage: true,
          },
        };
      }

      case "read": {
        if (!hubClient || !mailDisplayService) {
          throw "Not available in local mode.";
        }
        const messageId = argv[1];
        if (!messageId) {
          throw "Invalid parameters. Please provide a message id.";
        }
        const { display } = await mailDisplayService.readMessage(messageId);
        return display;
      }

      case "archive": {
        if (!hubClient) {
          throw "Not available in local mode.";
        }
        const messageIds = argv[1]?.split(",").map((id) => id.trim());
        if (!messageIds || messageIds.length === 0) {
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
    usernames: string[],
    subject: string,
    message: string,
  ): Promise<string> {
    message = message.replace(/\\n/g, "\n");

    if (hubClient) {
      const response = await hubClient.sendRequest<MailSendResponse>(
        HubEvents.MAIL_SEND,
        {
          fromUserId: localUserId,
          toUsernames: usernames,
          subject,
          body: message,
        },
      );

      if (!response.success) {
        throw response.error || "Failed to send message";
      }

      return "Mail sent";
    }

    // Local mode: resolve users via userService and emit to event bus
    const resolvedRecipients: { id: string; username: string }[] = [];
    const errors: string[] = [];

    for (const username of usernames) {
      const user = userService.getUserByName(username);
      if (!user) {
        errors.push(`${username} not found`);
      } else {
        resolvedRecipients.push({
          id: user.userId,
          username: user.config.username,
        });
      }
    }

    if (errors.length > 0) {
      throw `Error: ${errors.join("; ")}`;
    }

    const recipientIds = resolvedRecipients.map((r) => r.id);

    emitMailDelivered(recipientIds, {
      fromUsername: localUsername,
      fromTitle: localTitle,
      recipientUsernames: resolvedRecipients.map((r) => r.username),
      subject,
      body: message,
      createdAt: new Date().toISOString(),
    });

    return "Mail sent";
  }

  async function archiveMessages(messageIds: string[]): Promise<string> {
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
    return userService.getUsers().map((u) => u.config.username);
  }

  function hasMultipleUsers(): boolean {
    return userService.getUsers().length > 1;
  }

  async function getUnreadThreads(): Promise<{ message_id: string }[]> {
    if (!hubClient) {
      return [];
    }

    const response = await hubClient.sendRequest<MailUnreadResponse>(
      HubEvents.MAIL_UNREAD,
      { userId: localUserId },
    );

    if (!response.success || !response.messageIds) {
      return [];
    }

    return response.messageIds.map((id) => ({ message_id: id }));
  }

  // Track message IDs that have been notified but not yet processed
  const notifiedMessageIds = new Set<string>();

  /**
   * Check for new mail and create a notification if there are unread messages.
   * Tracks notified message IDs to avoid duplicate notifications.
   * (Hub mode only)
   */
  async function checkAndNotify(): Promise<void> {
    if (!hubClient || !mailDisplayService) return;

    const unreadMessages = await getUnreadThreads();
    if (!unreadMessages.length) {
      return;
    }

    // Filter out messages we've already notified about
    const newMessages = unreadMessages.filter(
      (m) => !notifiedMessageIds.has(m.message_id),
    );
    if (!newMessages.length) {
      return;
    }

    // Track these message IDs as notified
    const messageIds = newMessages.map((m) => m.message_id);
    messageIds.forEach((id) => notifiedMessageIds.add(id));

    promptNotification.notify({
      type: "mail",
      wake: agentConfig().wakeOnMessage,
      process: async () => {
        for (const messageId of messageIds) {
          const { display } = await mailDisplayService.readMessage(messageId);
          await contextManager.append("New Message:", ContentSource.Console);
          await contextManager.append(display, ContentSource.Console);
          notifiedMessageIds.delete(messageId);
        }
      },
    });
  }

  // Set up notification listeners based on mode
  let cleanupFn: () => void;

  if (hubClient) {
    // Hub mode: listen for MAIL_RECEIVED push from hub
    const mailReceivedHandler = (data: unknown) => {
      const push = data as MailReceivedPush;
      if (push.recipientUserIds.includes(localUserId)) {
        void checkAndNotify();
      }
    };
    hubClient.registerEvent(HubEvents.MAIL_RECEIVED, mailReceivedHandler);

    // Check for mail that arrived while offline
    void checkAndNotify();

    cleanupFn = () => {
      hubClient.unregisterEvent(HubEvents.MAIL_RECEIVED, mailReceivedHandler);
    };
  } else {
    // Local mode: listen for mail delivery via event bus
    const unsubscribe = onMailDelivered(localUserId, (content: MailContent) => {
      promptNotification.notify({
        type: "mail",
        wake: agentConfig().wakeOnMessage,
        process: async () => {
          const display = formatMessageDisplay(content);
          await contextManager.append("New Message:", ContentSource.Console);
          await contextManager.append(display, ContentSource.Console);
        },
      });
    });

    cleanupFn = unsubscribe;
  }

  function cleanup() {
    cleanupFn();
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-mail",
    helpText: "Send and receive messages",
    handleCommand,
  };

  return {
    ...registrableCommand,
    getUnreadThreads,
    sendMessage,
    getAllUserNames,
    hasMultipleUsers,
    checkAndNotify,
    cleanup,
  };
}

export type MailService = ReturnType<typeof createMailService>;
