import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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
  const adapter = new PrismaBetterSqlite3({
    url: `file:${databasePath}`,
  });
  return new PrismaClient({ adapter });
}
