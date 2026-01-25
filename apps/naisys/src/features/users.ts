import { isAgentOnline, isHostOnline } from "@naisys/common";
import { DatabaseService } from "@naisys/database";
import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";

interface UserRow {
  id: string;
  username: string;
  title: string;
  lead_user_id: string | null;
  host: { name: string } | null;
  user_notifications: { last_active: Date | null } | null;
}

interface UserNode extends UserRow {
  children: UserNode[];
}

type UserStatus = "Running" | "Available" | "Offline";

export function createUsersService(
  dbService: DatabaseService,
) {
  const { usingDatabase } = dbService;

  // Cache for multi-host check
  let multiHostCache: boolean | null = null;

  async function hasMultipleHosts(): Promise<boolean> {
    if (multiHostCache !== null) {
      return multiHostCache;
    }
    return await usingDatabase(async (prisma) => {
      const count = await prisma.hosts.count();
      multiHostCache = count > 1;
      return multiHostCache;
    });
  }

  function determineStatus(
    userLastActive: Date | null | undefined,
    hostLastActive: Date | null | undefined
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
    depth: number = 0
  ): { user: UserNode; depth: number }[] {
    const result: { user: UserNode; depth: number }[] = [];

    // Sort nodes alphabetically by username at each level
    const sortedNodes = [...nodes].sort((a, b) =>
      a.username.localeCompare(b.username)
    );

    for (const node of sortedNodes) {
      result.push({ user: node, depth });
      result.push(...flattenHierarchy(node.children, depth + 1));
    }

    return result;
  }

  async function handleCommand(cmdArgs: string): Promise<string> {
    const args = cmdArgs.trim();

    if (args === "help" || args === "--help" || args === "-h") {
      return getHelp();
    }

    if (args !== "") {
      return `Unknown argument: ${args}\n\n${getHelp()}`;
    }

    return await listUsers();
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
          host: { select: { name: true, last_active: true } },
          user_notifications: { select: { last_active: true } },
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
        const hostLastActive = (user.host as any)?.last_active ?? null;
        const status = determineStatus(
          user.user_notifications?.last_active,
          hostLastActive
        );

        if (isMultiHost) {
          return [
            displayName,
            user.title,
            user.host?.name || "(unknown)",
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

  function getHelp(): string {
    return `ns-users - List all users/agents in the organization

Usage: ns-users

Displays all users in a hierarchical tree based on lead relationships.

Status meanings:
  Running   - Agent is currently active
  Available - Agent not running, but host is online (can be started)
  Offline   - Agent's host is offline`;
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-users",
    handleCommand,
  };

  return {
    ...registrableCommand,
    listUsers,
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
