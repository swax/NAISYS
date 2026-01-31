import { DatabaseService } from "@naisys/database";

export function createMailAddress({ usingDatabase }: DatabaseService) {
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
    // Strip @host part if present (no longer needed for disambiguation)
    const atIndex = identifier.lastIndexOf("@");
    const username = atIndex > 0 ? identifier.slice(0, atIndex) : identifier;

    // Find matching users
    const matchingUsers = await tx.users.findMany({
      where: {
        username,
        deleted_at: null,
      },
      select: {
        id: true,
        username: true,
      },
    });

    if (matchingUsers.length === 0) {
      throw `${username} not found`;
    }

    if (matchingUsers.length === 1) {
      return {
        id: matchingUsers[0].id,
        username: matchingUsers[0].username,
      };
    }

    throw `Multiple users named '${username}' exist.`;
  }

  return {
    hasMultipleHosts,
    formatUserWithHost,
    resolveUserIdentifier,
  };
}

export type MailAddress = ReturnType<typeof createMailAddress>;
