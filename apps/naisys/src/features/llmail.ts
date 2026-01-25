import { DatabaseService, ulid } from "@naisys/database";
import stringArgv from "string-argv";
import table from "text-table";
import { AgentConfig } from "../agent/agentConfig.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { LLMailAddress } from "./llmailAddress.js";
import * as utilities from "../utils/utilities.js";

export function createLLMail(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  { usingDatabase }: DatabaseService,
  hostService: HostService,
  llmailAddress: LLMailAddress,
  userId: string,
) {
  const myUserId = userId;
  const { localHostId } = hostService;
  const { hasMultipleHosts, formatUserWithHost, resolveUserIdentifier } =
    llmailAddress;

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
        return listMessages(filterArg as "received" | "sent" | undefined);
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
        return listUsers();

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

        return searchMessages(terms.join(" "), includeArchived, subjectOnly);
      }

      default: {
        const helpResponse = await handleCommand("help");
        const helpContent =
          typeof helpResponse === "string" ? helpResponse : helpResponse.content;
        return "Error, unknown command. See valid commands below:\n" + helpContent;
      }
    }
  }

  interface UnreadMessage {
    message_id: string;
  }

  async function getUnreadThreads(): Promise<UnreadMessage[]> {
    return await usingDatabase(async (prisma) => {
      const messages = await prisma.mail_messages.findMany({
        where: {
          recipients: { some: { user_id: myUserId } },
          AND: [
            { status: { none: { user_id: myUserId, read_at: { not: null } } } },
            {
              status: {
                none: { user_id: myUserId, archived_at: { not: null } },
              },
            },
          ],
        },
        select: { id: true },
      });

      return messages.map((m) => ({ message_id: m.id }));
    });
  }

  async function listMessages(
    filter?: "received" | "sent"
  ): Promise<string> {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Build where clause based on filter
      const ownershipCondition =
        filter === "received"
          ? { recipients: { some: { user_id: myUserId } } }
          : filter === "sent"
            ? { from_user_id: myUserId }
            : {
                OR: [
                  { from_user_id: myUserId },
                  { recipients: { some: { user_id: myUserId } } },
                ],
              };

      const messages = await prisma.mail_messages.findMany({
        where: {
          ...ownershipCondition,
          status: {
            none: { user_id: myUserId, archived_at: { not: null } },
          },
        },
        include: {
          from_user: { select: { username: true, host: { select: { name: true } } } },
          recipients: {
            include: { user: { select: { username: true, host: { select: { name: true } } } } },
          },
          status: { where: { user_id: myUserId }, select: { read_at: true } },
        },
        orderBy: { created_at: "desc" },
        take: 20,
      });

      if (messages.length === 0) {
        return "No messages found.";
      }

      // Determine header and user column based on filter
      const userHeader = filter === "sent" ? "To" : "From";

      return table(
        [
          ["", "ID", userHeader, "Subject", "Date"],
          ...messages.map((m) => {
            const status = m.status[0];
            const isUnread = m.from_user_id !== myUserId && !status?.read_at;

            // Show recipients for sent, sender for received/all
            const userColumn =
              filter === "sent"
                ? m.recipients
                    .map((r) =>
                      formatUserWithHost(r.user, isMultiHost)
                    )
                    .join(", ")
                : formatUserWithHost(m.from_user, isMultiHost);

            return [
              isUnread ? "*" : "",
              m.id.slice(-4),
              userColumn,
              m.subject.length > 40
                ? m.subject.slice(0, 37) + "..."
                : m.subject,
              new Date(m.created_at).toLocaleString(),
            ];
          }),
        ],
        { hsep: " | " }
      );
    });
  }

  async function sendMessage(
    userIdentifiers: string[],
    subject: string,
    message: string
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
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Find the message (support short IDs)
      const messages = await prisma.mail_messages.findMany({
        where: { id: { endsWith: messageId } },
        include: {
          from_user: {
            select: { username: true, title: true, host: { select: { name: true } } },
          },
          recipients: {
            include: {
              user: {
                select: { username: true, host: { select: { name: true } } },
              },
            },
          },
        },
      });

      if (messages.length === 0) {
        throw `Error: Message ${messageId} not found`;
      }

      if (messages.length > 1) {
        throw `Error: Multiple messages match '${messageId}'. Please use more characters.`;
      }

      const message = messages[0];
      const toUsers = message.recipients
        .map((r) => formatUserWithHost(r.user, isMultiHost))
        .join(", ");
      const fromUser = formatUserWithHost(message.from_user, isMultiHost);

      // Mark as read - upsert mail_status
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
            host_id: localHostId, // Recipient's host
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

      return (
        `Subject: ${message.subject}\n` +
        `From: ${fromUser}\n` +
        `Title: ${message.from_user.title}\n` +
        `To: ${toUsers}\n` +
        `Date: ${new Date(message.created_at).toLocaleString()}\n` +
        `Message:\n` +
        `${message.body}`
      );
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
              host_id: localHostId, // Recipient's host
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

  async function searchMessages(
    searchTerm: string,
    includeArchived: boolean,
    subjectOnly: boolean
  ): Promise<string> {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Build search condition
      const searchCondition = subjectOnly
        ? { subject: { contains: searchTerm } }
        : {
            OR: [
              { subject: { contains: searchTerm } },
              { body: { contains: searchTerm } },
            ],
          };

      // Build archive condition
      const archiveCondition = includeArchived
        ? {}
        : {
            status: { none: { user_id: myUserId, archived_at: { not: null } } },
          };

      const messages = await prisma.mail_messages.findMany({
        where: {
          OR: [
            { from_user_id: myUserId },
            { recipients: { some: { user_id: myUserId } } },
          ],
          ...searchCondition,
          ...archiveCondition,
        },
        include: {
          from_user: { select: { username: true, host: { select: { name: true } } } },
        },
        orderBy: { created_at: "desc" },
        take: 50,
      });

      if (messages.length === 0) {
        return "No messages found matching search criteria.";
      }

      return table(
        [
          ["ID", "Subject", "From", "Date"],
          ...messages.map((m) => [
            m.id.slice(-4),
            m.subject.length > 40 ? m.subject.slice(0, 37) + "..." : m.subject,
            formatUserWithHost(m.from_user, isMultiHost),
            new Date(m.created_at).toLocaleString(),
          ]),
        ],
        { hsep: " | " }
      );
    });
  }

  async function listUsers() {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      const userList = await prisma.users.findMany({
        where: {
          deleted_at: null, // Only show active users
        },
        select: {
          username: true,
          title: true,
          lead_user: { select: { username: true } },
          host: { select: { name: true } },
          user_notifications: { select: { last_active: true } },
        },
      });

      return table(
        [
          ["Username", "Title", "Lead", "Status"],
          ...userList.map((u) => {
            const lastActive = u.user_notifications?.last_active;
            const isActive = lastActive
              ? new Date(lastActive).getTime() > Date.now() - 5 * 1000
              : false;
            return [
              formatUserWithHost(u, isMultiHost),
              u.title,
              u.lead_user?.username || "",
              isActive ? "Online" : "Offline",
            ];
          }),
        ],
        { hsep: " | " }
      );
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
    handleCommand,
  };

  return {
    ...registrableCommand,
    getUnreadThreads,
    sendMessage,
    readMessage,
    getAllUserNames,
    hasMultipleUsers,
  };
}

export type LLMail = ReturnType<typeof createLLMail>;
