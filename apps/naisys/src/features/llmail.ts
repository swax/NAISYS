import { DatabaseService, ulid } from "@naisys/database";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import * as utilities from "../utils/utilities.js";
import { LLMailAddress } from "./llmailAddress.js";
import { MailDisplayService } from "./mailDisplayService.js";

export function createLLMail(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  { usingDatabase }: DatabaseService,
  hostService: HostService,
  llmailAddress: LLMailAddress,
  mailDisplayService: MailDisplayService,
  userId: string,
) {
  const myUserId = userId;
  const { localHostId } = hostService;
  const { resolveUserIdentifier } = llmailAddress;

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);

    if (!argv[0]) {
      argv[0] = "help";
    }

    const tokenMaxNote = agentConfig().mailMessageTokenMax
      ? ` ${agentConfig().mailMessageTokenMax} token max`
      : "";

    switch (argv[0]) {
      case "help":
        return `ns-mail <command>
  list [received|sent]               List recent messages (non-archived, * = unread)
  read <id>                          Read a message (marks as read)
  send "<users>" "<subject>" "<msg>" Send a message.${tokenMaxNote}
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

    validateMsgTokenCount(message);

    return await usingDatabase(async (prisma) => {
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
            from_user_id: myUserId,
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
              host_id: localHostId, // Sender's host
              type: "to",
              created_at: new Date(),
            },
          });
        }

        return "Mail sent";
      });
    });
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
      const existingStatus = await prisma.mail_status.findUnique({
        where: {
          message_id_user_id: {
            message_id: messageId,
            user_id: myUserId,
          },
        },
      });

      if (!existingStatus) {
        await prisma.mail_status.create({
          data: {
            id: ulid(),
            message_id: messageId,
            user_id: myUserId,
            host_id: localHostId,
            read_at: new Date(),
            created_at: new Date(),
          },
        });
      } else if (!existingStatus.read_at) {
        await prisma.mail_status.update({
          where: { id: existingStatus.id },
          data: { read_at: new Date() },
        });
      }
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

        // Upsert mail_status with archived_at
        const existingStatus = await prisma.mail_status.findUnique({
          where: {
            message_id_user_id: {
              message_id: message.id,
              user_id: myUserId,
            },
          },
        });

        if (!existingStatus) {
          await prisma.mail_status.create({
            data: {
              id: ulid(),
              message_id: message.id,
              user_id: myUserId,
              host_id: localHostId,
              archived_at: new Date(),
              created_at: new Date(),
            },
          });
        } else {
          await prisma.mail_status.update({
            where: { id: existingStatus.id },
            data: { archived_at: new Date() },
          });
        }
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

  function validateMsgTokenCount(message: string) {
    const msgTokenCount = utilities.getTokenCount(message);
    const msgTokenMax = agentConfig().mailMessageTokenMax;

    if (msgTokenMax && msgTokenCount > msgTokenMax) {
      throw `Error: Message is ${msgTokenCount} tokens, exceeding the limit of ${msgTokenMax} tokens`;
    }

    return msgTokenCount;
  }

  async function hasMultipleUsers(): Promise<boolean> {
    return await usingDatabase(async (prisma) => {
      const count = await prisma.users.count();

      return count > 1;
    });
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-mail",
    helpText: "Send and receive messages",
    handleCommand,
  };

  return {
    ...registrableCommand,
    getUnreadThreads: mailDisplayService.getUnreadThreads,
    sendMessage,
    readMessage,
    getAllUserNames,
    hasMultipleUsers,
  };
}

export type LLMail = ReturnType<typeof createLLMail>;
