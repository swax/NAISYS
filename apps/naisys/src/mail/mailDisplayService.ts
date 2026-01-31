import { isAgentOnline, isHostOnline } from "@naisys/common";
import { DatabaseService } from "@naisys/database";
import table from "text-table";
import { MailAddress } from "./mailAddress.js";

export function createMailDisplayService(
  { usingDatabase }: DatabaseService,
  mailAddress: MailAddress,
  localUserId: string,
) {
  const { hasMultipleHosts, formatUserWithHost } = mailAddress;

  async function listMessages(filter?: "received" | "sent"): Promise<string> {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Build where clause based on filter
      const ownershipCondition =
        filter === "received"
          ? { recipients: { some: { user_id: localUserId } } }
          : filter === "sent"
            ? { from_user_id: localUserId }
            : {
                OR: [
                  { from_user_id: localUserId },
                  { recipients: { some: { user_id: localUserId } } },
                ],
              };

      const messages = await prisma.mail_messages.findMany({
        where: {
          ...ownershipCondition,
          NOT: {
            recipients: {
              some: { user_id: localUserId, archived_at: { not: null } },
            },
          },
        },
        include: {
          from_user: {
            select: { username: true },
          },
          recipients: {
            include: {
              user: {
                select: { username: true },
              },
            },
          },
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
            const myRecipient = m.recipients.find(
              (r) => r.user_id === localUserId,
            );
            const isUnread =
              m.from_user_id !== localUserId && !myRecipient?.read_at;

            // Show recipients for sent, sender for received/all
            const userColumn =
              filter === "sent"
                ? m.recipients
                    .map((r) => formatUserWithHost(r.user, isMultiHost))
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
        { hsep: " | " },
      );
    });
  }

  async function readMessage(
    messageId: string,
  ): Promise<{ fullMessageId: string; display: string }> {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Find the message (support short IDs)
      const messages = await prisma.mail_messages.findMany({
        where: { id: { endsWith: messageId } },
        include: {
          from_user: {
            select: {
              username: true,
              title: true,
            },
          },
          recipients: {
            include: {
              user: {
                select: { username: true },
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

      const display =
        `Subject: ${message.subject}\n` +
        `From: ${fromUser}\n` +
        `Title: ${message.from_user.title}\n` +
        `To: ${toUsers}\n` +
        `Date: ${new Date(message.created_at).toLocaleString()}\n` +
        `Message:\n` +
        `${message.body}`;

      return { fullMessageId: message.id, display };
    });
  }

  async function searchMessages(
    searchTerm: string,
    includeArchived: boolean,
    subjectOnly: boolean,
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
            NOT: {
              recipients: {
                some: { user_id: localUserId, archived_at: { not: null } },
              },
            },
          };

      const messages = await prisma.mail_messages.findMany({
        where: {
          OR: [
            { from_user_id: localUserId },
            { recipients: { some: { user_id: localUserId } } },
          ],
          ...searchCondition,
          ...archiveCondition,
        },
        include: {
          from_user: {
            select: { username: true },
          },
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
        { hsep: " | " },
      );
    });
  }

  interface UserRow {
    id: string;
    username: string;
    title: string;
    lead_user_id: string | null;
    user_notifications: {
      last_active: Date | null;
      host: { name: string; last_active: Date | null } | null;
    } | null;
  }

  interface UserNode extends UserRow {
    children: UserNode[];
  }

  type UserStatus = "Running" | "Available" | "Offline";

  function determineStatus(
    userLastActive: Date | null | undefined,
    hostLastActive: Date | null | undefined,
  ): UserStatus {
    // Running: agent was active within USER_ONLINE_THRESHOLD_MS
    if (isAgentOnline(userLastActive ?? undefined)) {
      return "Running";
    }

    // Available: agent not active but host is online
    if (isHostOnline(hostLastActive ?? undefined)) {
      return "Available";
    }

    // Offline: host is not online
    return "Offline";
  }

  function buildHierarchy(users: UserRow[]): UserNode[] {
    const userMap = new Map<string, UserNode>();
    const roots: UserNode[] = [];

    // Create nodes for all users
    for (const user of users) {
      userMap.set(user.id, { ...user, children: [] });
    }

    // Build tree by linking children to parents
    for (const user of users) {
      const node = userMap.get(user.id)!;
      if (user.lead_user_id && userMap.has(user.lead_user_id)) {
        userMap.get(user.lead_user_id)!.children.push(node);
      } else {
        // No lead or lead not found - this is a root node
        roots.push(node);
      }
    }

    return roots;
  }

  function flattenHierarchy(
    nodes: UserNode[],
    depth: number = 0,
  ): { user: UserNode; depth: number }[] {
    const result: { user: UserNode; depth: number }[] = [];

    // Sort nodes alphabetically by username at each level
    const sortedNodes = [...nodes].sort((a, b) =>
      a.username.localeCompare(b.username),
    );

    for (const node of sortedNodes) {
      result.push({ user: node, depth });
      result.push(...flattenHierarchy(node.children, depth + 1));
    }

    return result;
  }

  async function listUsers(): Promise<string> {
    const isMultiHost = await hasMultipleHosts();

    return await usingDatabase(async (prisma) => {
      // Fetch all active users with their relationships
      const users = await prisma.users.findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          username: true,
          title: true,
          lead_user_id: true,
          user_notifications: {
            select: {
              last_active: true,
              host: { select: { name: true, last_active: true } },
            },
          },
        },
        orderBy: { username: "asc" },
      });

      if (users.length === 0) {
        return "No users found.";
      }

      // Build hierarchy and flatten for display
      const hierarchy = buildHierarchy(users);
      const flattened = flattenHierarchy(hierarchy);

      // Create lookup map for lead usernames
      const userIdToUsername = new Map<string, string>();
      for (const user of users) {
        userIdToUsername.set(user.id, user.username);
      }

      // Build table rows
      const headers = isMultiHost
        ? ["Username", "Title", "Host", "Lead", "Status"]
        : ["Username", "Title", "Lead", "Status"];

      const rows = flattened.map(({ user, depth }) => {
        const indent = "  ".repeat(depth);
        const displayName = `${indent}${user.username}`;
        const leadUsername = user.lead_user_id
          ? userIdToUsername.get(user.lead_user_id) || "(unknown)"
          : "(none)";
        const status = determineStatus(
          user.user_notifications?.last_active,
          user.user_notifications?.host?.last_active,
        );

        if (isMultiHost) {
          return [
            displayName,
            user.title,
            user.user_notifications?.host?.name || "(unknown)",
            leadUsername,
            status,
          ];
        } else {
          return [displayName, user.title, leadUsername, status];
        }
      });

      return table([headers, ...rows], { hsep: " | " });
    });
  }

  return {
    listMessages,
    readMessage,
    searchMessages,
    listUsers,
  };
}

export type MailDisplayService = ReturnType<typeof createMailDisplayService>;
