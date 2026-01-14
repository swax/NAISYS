import { encodeTime } from "ulid";
import { PrismaClient } from "./generated/prisma/client.js";

/**
 * Serialize a database record for sync transmission.
 * Converts Date objects to ISO strings.
 */
export function serializeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    serialized[key] = value instanceof Date ? value.toISOString() : value;
  }
  return serialized;
}

/**
 * Serialize an array of database records for sync transmission.
 */
export function serializeRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.map(serializeRecord);
}

/**
 * Configuration for syncable tables.
 * Defines primary key column(s) for each table to support different PK structures.
 * Tables with appendOnly: true use ULID-based sync (id > since_ulid) instead of updated_at.
 */
export const SYNCABLE_TABLE_CONFIG: Record<
  string,
  { primaryKey: string[]; appendOnly?: boolean }
> = {
  hosts: { primaryKey: ["id"] },
  users: { primaryKey: ["id"] },
  user_notifications: { primaryKey: ["user_id"] },
  mail_threads: { primaryKey: ["id"] },
  mail_thread_members: { primaryKey: ["id"] },
  mail_thread_messages: { primaryKey: ["id"], appendOnly: true },
  run_session: { primaryKey: ["user_id", "run_id", "session_id"] },
  context_log: { primaryKey: ["id"], appendOnly: true },
  costs: { primaryKey: ["id"] },
};

/**
 * Tables that support sync.
 * Order matters for foreign key dependencies (e.g., hosts before users).
 */
export const SYNCABLE_TABLES = Object.keys(SYNCABLE_TABLE_CONFIG) as SyncableTable[];

export type SyncableTable = keyof typeof SYNCABLE_TABLE_CONFIG;

/**
 * Convert a timestamp to a ULID prefix for efficient range queries.
 * ULIDs are lexicographically sortable, so id > prefix matches all ULIDs after that time.
 */
function timestampToUlidPrefix(timestamp: Date): string {
  // encodeTime returns the 10-character time component of a ULID
  // Pad with zeros for the random component to get the minimum ULID for that timestamp
  return encodeTime(timestamp.getTime(), 10) + "0".repeat(16);
}

/**
 * Query records from a table that have been updated/created since a given timestamp.
 * For append-only tables (appendOnly: true), uses ULID-based queries (id > since_ulid).
 * For other tables, uses updated_at timestamp queries.
 * Returns records plus a hasMore flag for pagination.
 */
export async function queryChangedRecords(
  prisma: PrismaClient,
  table: SyncableTable,
  since: Date,
  limit: number
): Promise<{ records: Record<string, unknown>[]; hasMore: boolean }> {
  const config = SYNCABLE_TABLE_CONFIG[table];
  const isAppendOnly = config?.appendOnly ?? false;

  // Use dynamic access with any - safe because table is from our whitelist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[table];

  let records: Record<string, unknown>[];

  if (isAppendOnly) {
    // Append-only tables: query by ULID (lexicographically sortable by time)
    const sinceUlid = timestampToUlidPrefix(since);
    records = (await model.findMany({
      where: { id: { gt: sinceUlid } },
      orderBy: { id: "asc" },
      take: limit + 1,
    })) as Record<string, unknown>[];
  } else {
    // Regular tables: query by updated_at
    records = (await model.findMany({
      where: { updated_at: { gt: since } },
      orderBy: { updated_at: "asc" },
      take: limit + 1,
    })) as Record<string, unknown>[];
  }

  const hasMore = records.length > limit;
  return {
    records: hasMore ? records.slice(0, limit) : records,
    hasMore,
  };
}

/**
 * Upsert a single record into a table using raw SQL.
 * Uses INSERT ... ON CONFLICT for atomic upsert.
 */
export async function upsertRecord(
  prisma: PrismaClient,
  table: SyncableTable,
  record: Record<string, unknown>
): Promise<void> {
  const config = SYNCABLE_TABLE_CONFIG[table];
  if (!config) {
    throw new Error(`Unknown syncable table: ${table}`);
  }

  const primaryKeyColumns = config.primaryKey;
  const columns = Object.keys(record);
  const values = columns.map((col) => {
    const val = record[col];
    // Convert ISO date strings back to proper format for SQLite
    if (typeof val === "string" && col.endsWith("_at")) {
      return val; // SQLite handles ISO strings fine
    }
    return val;
  });

  // Build column list and placeholders
  const columnList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");

  // Build UPDATE clause (exclude primary key columns from updates)
  const updateColumns = columns.filter((c) => !primaryKeyColumns.includes(c));
  const updateClause = updateColumns.map((c) => `${c} = excluded.${c}`).join(", ");

  // Build ON CONFLICT clause with the correct primary key column(s)
  const conflictColumns = primaryKeyColumns.join(", ");

  const sql = `
    INSERT INTO ${table} (${columnList})
    VALUES (${placeholders})
    ON CONFLICT(${conflictColumns}) DO UPDATE SET ${updateClause}
  `;

  await prisma.$executeRawUnsafe(sql, ...values);
}

/**
 * Upsert multiple records into a table.
 */
export async function upsertRecords(
  prisma: PrismaClient,
  table: SyncableTable,
  records: Record<string, unknown>[]
): Promise<void> {
  for (const record of records) {
    await upsertRecord(prisma, table, record);
  }
}
