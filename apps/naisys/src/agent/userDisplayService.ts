import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { UserService } from "./userService.js";

interface UserNode {
  userId: string;
  username: string;
  title: string;
  leadUserId?: string;
  children: UserNode[];
}

function buildHierarchy(
  users: { userId: string; username: string; title: string; leadUserId?: string }[],
): UserNode[] {
  const nodeMap = new Map<string, UserNode>();
  const roots: UserNode[] = [];

  for (const user of users) {
    nodeMap.set(user.userId, { ...user, children: [] });
  }

  for (const user of users) {
    const node = nodeMap.get(user.userId)!;
    if (user.leadUserId && nodeMap.has(user.leadUserId)) {
      nodeMap.get(user.leadUserId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function flattenHierarchy(
  nodes: UserNode[],
  depth: number = 0,
): { node: UserNode; depth: number }[] {
  const result: { node: UserNode; depth: number }[] = [];

  const sortedNodes = [...nodes].sort((a, b) =>
    a.username.localeCompare(b.username),
  );

  for (const node of sortedNodes) {
    result.push({ node, depth });
    result.push(...flattenHierarchy(node.children, depth + 1));
  }

  return result;
}

export function createUserDisplayService(userService: UserService) {
  async function handleCommand(): Promise<string> {
    const allUsers = userService.getUsers();

    // Filter out debug user
    const users = allUsers.filter((u) => u.userId !== "0");

    if (users.length === 0) {
      return "No users found.";
    }

    const userItems = users.map((u) => ({
      userId: u.userId,
      username: u.config.username,
      title: u.config.title,
      leadUserId: u.leadUserId,
    }));

    const hierarchy = buildHierarchy(userItems);
    const flattened = flattenHierarchy(hierarchy);

    // Build userId → username lookup for lead display
    const userIdToUsername = new Map<string, string>();
    for (const u of userItems) {
      userIdToUsername.set(u.userId, u.username);
    }

    const headers = ["Username", "Title", "Lead", "Status"];
    const rows = flattened.map(({ node, depth }) => {
      const indent = "  ".repeat(depth);
      const displayName = `${indent}${node.username}`;
      const leadUsername = node.leadUserId
        ? userIdToUsername.get(node.leadUserId) || "(unknown)"
        : "(none)";
      const status = userService.isUserActive(node.userId)
        ? "Running"
        : "Offline";

      return [displayName, node.title, leadUsername, status];
    });

    return table([headers, ...rows], { hsep: " | " });
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-users",
    helpText: "List all users and their status",
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type UserDisplayService = ReturnType<typeof createUserDisplayService>;
