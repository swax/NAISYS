// Re-export Prisma Client and all generated types
export { PrismaClient } from "./generated/prisma/client.js";
export * from "./generated/prisma/client.js";

// Import PrismaClient at the top level for the factory function
import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Create a Prisma client with a dynamic database path
 * @param databasePath - Absolute path to the SQLite database file
 * @returns Configured PrismaClient instance
 *
 * @example
 * ```typescript
 * const prisma = createPrismaClient("/home/user/.naisys/database/naisys.sqlite");
 * const users = await prisma.users.findMany();
 * ```
 */
export function createPrismaClient(databasePath: string) {
  return new PrismaClient({
    datasources: {
      db: {
        url: `file:${databasePath}`,
      },
    },
  });
}
