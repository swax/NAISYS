import { DatabaseService } from "@naisys/database";
import { HostService } from "../services/hostService.js";

export function createLLMailAddress(
  { usingDatabase }: DatabaseService,
  hostService: HostService,
) {
  const { localHostId } = hostService;

  // Cache for multi-host check (reset per session)
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

  // Common user structure with username and optional host
  interface UserWithHost {
    username: string;
    host?: { name: string } | null;
  }

  // Format username with host when multiple hosts exist
  function formatUserWithHost(
    user: UserWithHost,
    isMultiHost: boolean,
  ): string {
    if (!isMultiHost) {
      return user.username;
    }
    return `${user.username}@${user.host?.name || "unknown"}`;
  }

  // Resolve user identifier (username or username@host) to user ID
  // Returns { id, username } or throws error
  interface ResolvedUser {
    id: string;
    username: string;
  }

  interface MatchedUser {
    id: string;
    username: string;
    host_id: string | null;
    host: { name: string } | null;
  }

  // Type for Prisma client or transaction client (both have users.findMany)
  interface PrismaLike {
    users: {
      findMany: (args: any) => Promise<MatchedUser[]>;
    };
  }

  async function resolveUserIdentifier(
    identifier: string,
    tx: PrismaLike,
  ): Promise<ResolvedUser> {
    // Parse username@host format
    const atIndex = identifier.lastIndexOf("@");
    let username: string;
    let hostName: string | null = null;

    if (atIndex > 0) {
      username = identifier.slice(0, atIndex);
      hostName = identifier.slice(atIndex + 1);
    } else {
      username = identifier;
    }

    // Find matching users
    const matchingUsers = await tx.users.findMany({
      where: {
        username,
        deleted_at: null,
        ...(hostName ? { host: { name: hostName } } : {}),
      },
      select: {
        id: true,
        username: true,
        host_id: true,
        host: { select: { name: true } },
      },
    });

    if (matchingUsers.length === 0) {
      throw hostName
        ? `${username}@${hostName} not found`
        : `${username} not found`;
    }

    if (matchingUsers.length === 1) {
      return {
        id: matchingUsers[0].id,
        username: matchingUsers[0].username,
      };
    }

    // Multiple users with same username - try to find one on localhost
    const localUser = matchingUsers.find((u) => u.host_id === localHostId);

    if (localUser) {
      return {
        id: localUser.id,
        username: localUser.username,
      };
    }

    // No local user and multiple matches - require username@host
    const hostOptions = matchingUsers
      .map((u) => `${u.username}@${u.host?.name || "unknown"}`)
      .join(", ");
    throw `Multiple users named '${username}' exist. Use one of: ${hostOptions}`;
  }

  return {
    hasMultipleHosts,
    formatUserWithHost,
    resolveUserIdentifier,
  };
}

export type LLMailAddress = ReturnType<typeof createLLMailAddress>;
