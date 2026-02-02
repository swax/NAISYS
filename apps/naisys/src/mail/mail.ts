import { DatabaseService, ulid } from "@naisys/database";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import { HostService } from "../services/hostService.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { MailAddress } from "./mailAddress.js";
import { emitMailSent, onMailReceived } from "./mailEventBus.js";
import { MailDisplayService } from "./mailDisplayService.js";

interface UnreadMessage {
  message_id: string;
}

export function createMailService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  { usingDatabase }: DatabaseService,
  hostService: HostService,
  mailAddress: MailAddress,
  mailDisplayService: MailDisplayService,
  localUserId: string,
  promptNotification: PromptNotificationService,
  contextManager: ContextManager,
) {
  const { localHostId } = hostService;
  const { resolveUserIdentifier } = mailAddress;

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    switch (argv[0]) {
      case "help":
        return `ns-mail <command>
  list [received|sent]               List recent messages (non-archived, * = unread)
  read <id>                          Read a message (marks as read)
  send "<users>" "<subject>" "<msg>" Send a message.
  archive <ids>                      Archive messages (comma-separated)
  search <terms> [-archived] [-subject] Search messages
  users                              List all users
  wait <seconds>                     Wait for new mail

* Attachments are not supported, use file paths to reference files in emails as all users are usually on the same machine`;

      case "list": {
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
        const messageId = argv[1];
        if (!messageId) {
          throw "Invalid parameters. Please provide a message id.";
        }
        return readMessage(messageId);
      }

      case "users":
        return mailDisplayService.listUsers();

      case "archive": {
        const messageIds = argv[1]?.split(",").map((id) => id.trim());
        if (!messageIds || messageIds.length === 0) {
          throw "Invalid parameters. Please provide comma-separated message ids.";
        }
        return archiveMessages(messageIds);
      }

      case "search": {
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
    userIdentifiers: string[],
    subject: string,
    message: string,
  ): Promise<string> {
    message = message.replace(/\\n/g, "\n");

    const recipientIds = await usingDatabase(async (prisma) => {
      return await prisma.$transaction(async (tx) => {
        // Resolve each user identifier to a user ID
        const resolvedRecipients: { id: string; username: string }[] = [];
        const errors: string[] = [];

        for (const identifier of userIdentifiers) {
          try {
            const resolved = await resolveUserIdentifier(identifier, tx as any);
            resolvedRecipients.push(resolved);
          } catch (error) {
            errors.push(String(error));
          }
        }

        if (errors.length > 0) {
          throw `Error: ${errors.join("; ")}`;
        }

        // Create message
        const messageId = ulid();
        await tx.mail_messages.create({
          data: {
            id: messageId,
            from_user_id: localUserId,
            host_id: localHostId,
            subject,
            body: message,
            created_at: new Date(),
          },
        });

        // Create recipient entries
        for (const recipient of resolvedRecipients) {
          await tx.mail_recipients.create({
            data: {
              id: ulid(),
              message_id: messageId,
              user_id: recipient.id,
              type: "to",
              created_at: new Date(),
            },
          });
        }

        return resolvedRecipients.map((r) => r.id);
      });
    });

    // Notify same-process agents immediately via event bus
    emitMailSent(recipientIds);

    return "Mail sent";
  }

  async function readMessage(messageId: string): Promise<string> {
    // Get the message display from the display service
    const { fullMessageId, display } =
      await mailDisplayService.readMessage(messageId);

    // Mark the message as read
    await markMessageAsRead(fullMessageId);

    return display;
  }

  async function markMessageAsRead(messageId: string): Promise<void> {
    await usingDatabase(async (prisma) => {
      await prisma.mail_recipients.updateMany({
        where: { message_id: messageId, user_id: localUserId, read_at: null },
        data: { read_at: new Date() },
      });
    });
  }

  async function archiveMessages(messageIds: string[]): Promise<string> {
    return await usingDatabase(async (prisma) => {
      for (const shortId of messageIds) {
        // Find the message (support short IDs)
        const messages = await prisma.mail_messages.findMany({
          where: { id: { endsWith: shortId } },
        });

        if (messages.length === 0) {
          throw `Error: Message ${shortId} not found`;
        }

        if (messages.length > 1) {
          throw `Error: Multiple messages match '${shortId}'. Please use more characters.`;
        }

        const message = messages[0];

        await prisma.mail_recipients.updateMany({
          where: { message_id: message.id, user_id: localUserId },
          data: { archived_at: new Date() },
        });
      }

      return `Messages ${messageIds.join(",")} archived`;
    });
  }

  async function getAllUserNames() {
    return await usingDatabase(async (prisma) => {
      const usersList = await prisma.users.findMany({
        select: { username: true },
      });

      return usersList.map((ul) => ul.username);
    });
  }

  async function getUnreadThreads(): Promise<UnreadMessage[]> {
    return await usingDatabase(async (prisma) => {
      const messages = await prisma.mail_messages.findMany({
        where: {
          recipients: { some: { user_id: localUserId, read_at: null } },
        },
        select: { id: true },
      });

      return messages.map((m) => ({ message_id: m.id }));
    });
  }

  async function hasMultipleUsers(): Promise<boolean> {
    return await usingDatabase(async (prisma) => {
      const count = await prisma.users.count();

      return count > 1;
    });
  }

  // Track message IDs that have been notified but not yet processed
  const notifiedMessageIds = new Set<string>();

  /**
   * Check for new mail and create a notification if there are unread messages.
   * Tracks notified message IDs to avoid duplicate notifications.
   */
  async function checkAndNotify(): Promise<void> {
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
        // Read and display each message
        for (const messageId of messageIds) {
          const content = await readMessage(messageId);
          await contextManager.append("New Message:", ContentSource.Console);
          await contextManager.append(content, ContentSource.Console);
          // Remove from notified set since it's now been processed
          notifiedMessageIds.delete(messageId);
        }
      },
    });
  }

  // Listen for same-process mail notifications (instant)
  const unsubscribeMailEvents = onMailReceived(localUserId, () => {
    void checkAndNotify();
  });

  // Poll for cross-machine mail (fallback)
  const mailCheckInterval = setInterval(() => {
    void checkAndNotify();
  }, 5000);

  function cleanup() {
    unsubscribeMailEvents();
    clearInterval(mailCheckInterval);
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
    readMessage,
    getAllUserNames,
    hasMultipleUsers,
    checkAndNotify,
    cleanup,
  };
}

export type MailService = ReturnType<typeof createMailService>;
