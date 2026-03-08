import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { erpDbUrl } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";

let _db: PrismaClient | undefined;

/**
 * Initialize the ERP database connection and run SQLite pragmas.
 * Must be called after the database directory/file exists (i.e. after migrations).
 */
export async function initErpDb() {
  if (_db) return;

  const adapter = new PrismaBetterSqlite3({
    url: erpDbUrl(),
    timeout: 10_000, // Wait up to 10s for SQLite lock to be released
  });
  _db = new PrismaClient({ adapter });

  // Enable WAL mode for better concurrent read/write performance
  await _db.$executeRawUnsafe("PRAGMA journal_mode=WAL");
  // NORMAL is safe with WAL and avoids an extra fsync per commit
  await _db.$executeRawUnsafe("PRAGMA synchronous=NORMAL");
  // SQLite doesn't enforce foreign keys by default — must be enabled per connection
  await _db.$executeRawUnsafe("PRAGMA foreign_keys=ON");
}

/** Lazily initialized Prisma client. First access creates the connection. */
const erpDb = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error(
        "erpDb accessed before initialization. Ensure migrations have completed first.",
      );
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export default erpDb;
