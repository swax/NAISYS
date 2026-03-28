import table from "text-table";

import { usersCmd } from "../command/commandDefs.js";
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

type FlatEntry =
  | { type: "user"; node: UserNode; depth: number }
  | { type: "hidden"; count: number; depth: number };

function flattenHierarchy(
  nodes: UserNode[],
  hiddenCounts: Map<number, number>,
  depth: number = 0,
): FlatEntry[] {
  const result: FlatEntry[] = [];

  const sortedNodes = [...nodes].sort((a, b) =>
    a.username.localeCompare(b.username),
  );

  for (const node of sortedNodes) {
    result.push({ type: "user", node, depth });
    result.push(...flattenHierarchy(node.children, hiddenCounts, depth + 1));

    const hidden = hiddenCounts.get(node.userId) ?? 0;
    if (hidden > 0) {
      result.push({ type: "hidden", count: hidden, depth: depth + 1 });
    }
  }

  return result;
}

/**
 * Collect the set of user IDs relevant to the current agent:
 * - All root nodes (no lead)
 * - Superiors chain (walking up leadUserId)
 * - Peers (direct subordinates of each superior, i.e. siblings)
 * - All subordinates (recursively walking down)
 */
function getRelevantUserIds(
  allUsers: { userId: number; leadUserId?: number }[],
  currentUserId: number,
): Set<number> {
  const relevant = new Set<number>();
  const byId = new Map(allUsers.map((u) => [u.userId, u]));
  const childrenOf = new Map<number, number[]>();

  for (const u of allUsers) {
    if (u.leadUserId != null) {
      const siblings = childrenOf.get(u.leadUserId);
      if (siblings) {
        siblings.push(u.userId);
      } else {
        childrenOf.set(u.leadUserId, [u.userId]);
      }
    }
  }

  // Root nodes
  for (const u of allUsers) {
    if (!u.leadUserId) {
      relevant.add(u.userId);
    }
  }

  // Walk up the chain (superiors) and include peers at each level
  let cursor = currentUserId;
  while (true) {
    relevant.add(cursor);
    const user = byId.get(cursor);
    if (!user?.leadUserId) break;
    // Add peers (all direct subordinates of our superior)
    for (const peerId of childrenOf.get(user.leadUserId) ?? []) {
      relevant.add(peerId);
    }
    cursor = user.leadUserId;
  }

  // Walk down: all subordinates recursively
  const addDescendants = (parentId: number) => {
    for (const childId of childrenOf.get(parentId) ?? []) {
      relevant.add(childId);
      addDescendants(childId);
    }
  };
  addDescendants(currentUserId);

  return relevant;
}

export function createUserDisplayService(
  userService: UserService,
  inputMode: InputModeService,
  localUserId: number,
) {
  function handleCommand(cmdArgs: string): string {
    const allUsers = userService.getUsers();

    if (allUsers.length === 0) {
      return "No users found.";
    }

    const targetUsername = cmdArgs.trim();
    let perspectiveUserId = localUserId;

    if (targetUsername) {
      const targetUser = userService.getUserByName(targetUsername);
      if (!targetUser) {
        return `Error: user '${targetUsername}' not found`;
      }
      perspectiveUserId = targetUser.userId;
    }

    const userItems = allUsers.map((u) => ({
      userId: u.userId,
      username: u.username,
      title: u.config.title,
      leadUserId: u.leadUserId,
    }));

    const relevantIds = getRelevantUserIds(userItems, perspectiveUserId);
    const filteredItems = userItems.filter((u) => relevantIds.has(u.userId));

    // Build full children map for hidden-count computation
    const fullChildrenOf = new Map<number, number[]>();
    for (const u of userItems) {
      if (u.leadUserId != null) {
        const children = fullChildrenOf.get(u.leadUserId);
        if (children) {
          children.push(u.userId);
        } else {
          fullChildrenOf.set(u.leadUserId, [u.userId]);
        }
      }
    }

    // Count all descendants of a user in the full tree
    const countAllDescendants = (userId: number): number => {
      let count = 0;
      for (const childId of fullChildrenOf.get(userId) ?? []) {
        count += 1 + countAllDescendants(childId);
      }
      return count;
    };

    // For each visible node, count hidden users in its direct hidden branches
    // (visible children handle their own hidden subtrees)
    const hiddenCounts = new Map<number, number>();
    for (const u of filteredItems) {
      let count = 0;
      for (const childId of fullChildrenOf.get(u.userId) ?? []) {
        if (!relevantIds.has(childId)) {
          count += 1 + countAllDescendants(childId);
        }
      }
      if (count > 0) {
        hiddenCounts.set(u.userId, count);
      }
    }

    const hierarchy = buildHierarchy(filteredItems);
    const flattened = flattenHierarchy(hierarchy, hiddenCounts);

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

    const rows = flattened.map((entry) => {
      if (entry.type === "hidden") {
        const indent = "  ".repeat(entry.depth);
        const row = [`${indent}(+${entry.count} not shown)`, "", "", ""];
        if (isDebug) row.push("");
        return row;
      }

      const { node, depth } = entry;
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
    command: usersCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type UserDisplayService = ReturnType<typeof createUserDisplayService>;
