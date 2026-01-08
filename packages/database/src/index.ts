// Re-export Prisma Client and all generated types
export { PrismaClient } from "./generated/prisma/client.js";
export * from "./generated/prisma/client.js";

// Import PrismaClient at the top level for the factory function
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

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
  const adapter = new PrismaBetterSqlite3({
    url: `file:${databasePath}`,
  });
  return new PrismaClient({ adapter });
}
