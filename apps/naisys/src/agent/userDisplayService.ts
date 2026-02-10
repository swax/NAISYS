import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { InputModeService } from "../utils/inputMode.js";
import { UserService } from "./userService.js";

interface UserNode {
  userId: number;
  username: string;
  title: string;
  leadUserId?: number;
  children: UserNode[];
}

function buildHierarchy(
  users: {
    userId: number;
    username: string;
    title: string;
    leadUserId?: number;
  }[],
): UserNode[] {
  const nodeMap = new Map<number, UserNode>();
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

export function createUserDisplayService(
  userService: UserService,
  inputMode: InputModeService,
) {
  function handleCommand(): string {
    const allUsers = userService.getUsers();

    if (allUsers.length === 0) {
      return "No users found.";
    }

    const userItems = allUsers.map((u) => ({
      userId: u.userId,
      username: u.username,
      title: u.config.title,
      leadUserId: u.leadUserId,
    }));

    const hierarchy = buildHierarchy(userItems);
    const flattened = flattenHierarchy(hierarchy);

    // Build userId → username lookup for lead display
    const userIdToUsername = new Map<number, string>();
    for (const u of userItems) {
      userIdToUsername.set(u.userId, u.username);
    }

    const isDebug = inputMode.isDebug();
    const headers = ["Username", "Title", "Lead", "Status"];
    if (isDebug) {
      headers.push("*Host");
    }

    const rows = flattened.map(({ node, depth }) => {
      const indent = "  ".repeat(depth);
      const displayName = `${indent}${node.username}`;
      const leadUsername = node.leadUserId
        ? userIdToUsername.get(node.leadUserId) || "(unknown)"
        : "(none)";

      const row = [
        displayName,
        node.title,
        leadUsername,
        userService.getUserStatus(node.userId),
      ];
      if (isDebug) {
        row.push(
          userService.getUserHostDisplayNames(node.userId).join(", ") || "",
        );
      }
      return row;
    });

    let output = table([headers, ...rows], { hsep: " | " });
    if (isDebug) {
      output += "\n* Only visible in debug mode";
    }
    return output;
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
