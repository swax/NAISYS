import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { erpDbUrl } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaBetterSqlite3({
  url: erpDbUrl(),
  timeout: 10_000, // Wait up to 10s for SQLite lock to be released
});
const erpDb = new PrismaClient({ adapter });

/**
 * Run SQLite pragmas on the ERP database connection.
 * Must be called after the database directory/file exists (i.e. after migrations).
 */
export async function initErpDb() {
  // Enable WAL mode for better concurrent read/write performance
  await erpDb.$executeRawUnsafe("PRAGMA journal_mode=WAL");
  // NORMAL is safe with WAL and avoids an extra fsync per commit
  await erpDb.$executeRawUnsafe("PRAGMA synchronous=NORMAL");
  // SQLite doesn't enforce foreign keys by default — must be enabled per connection
  await erpDb.$executeRawUnsafe("PRAGMA foreign_keys=ON");
}

export default erpDb;
