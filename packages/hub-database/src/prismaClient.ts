import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Create a Prisma client with a dynamic database path
 * @param databasePath - Absolute path to the SQLite database file
 * @returns Configured PrismaClient instance
 */
export async function createPrismaClient(databasePath: string) {
  const adapter = new PrismaBetterSqlite3({
    url: `file:${databasePath}`,
    timeout: 10_000, // Wait up to 10s for SQLite lock to be released
  });
  const prisma = new PrismaClient({ adapter });

  // Enable WAL mode for better concurrent read/write performance
  await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL");
  // NORMAL is safe with WAL and avoids an extra fsync per commit
  await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL");
  // SQLite doesn't enforce foreign keys by default — must be enabled per connection
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON");

  return prisma;
}
