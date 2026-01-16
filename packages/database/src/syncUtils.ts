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
 * Host filter types for sync queries:
 * - "none": No host filtering (table is already host-scoped or needs all records)
 * - "direct_id": Filter on id = localHostId (for hosts table)
 * - "direct_host_id": Filter on host_id = localHostId (for users table)
 * - "join_user": Join through users relation via user_id, check users.host_id
 * - "join_updated_by": Join through updated_user relation via updated_by, check updated_user.host_id
 */
export type HostFilterType =
  | "none"
  | "direct_id"
  | "direct_host_id"
  | "join_user"
  | "join_updated_by";

interface SyncableTableConfig {
  primaryKey: string[];
  appendOnly?: boolean;
  hostFilter: HostFilterType;
}

/**
 * Configuration for syncable tables.
 * Defines primary key column(s) for each table to support different PK structures.
 * Tables with appendOnly: true use ULID-based sync (id > since_ulid) instead of updated_at.
 * hostFilter determines how to filter records by the local host.
 */
export const SYNCABLE_TABLE_CONFIG: Record<string, SyncableTableConfig> = {
  hosts: { primaryKey: ["id"], hostFilter: "direct_id" },
  users: { primaryKey: ["id"], hostFilter: "direct_host_id" },
  user_notifications: { primaryKey: ["user_id"], hostFilter: "join_user" },
  mail_threads: { primaryKey: ["id"], hostFilter: "join_updated_by" },
  mail_thread_members: { primaryKey: ["id"], hostFilter: "join_updated_by" },
  mail_thread_messages: {
    primaryKey: ["id"],
    appendOnly: true,
    hostFilter: "join_user",
  },
  run_session: {
    primaryKey: ["user_id", "run_id", "session_id"],
    hostFilter: "none",
  },
  context_log: { primaryKey: ["id"], appendOnly: true, hostFilter: "none" },
  costs: { primaryKey: ["id"], hostFilter: "none" },
};

/**
 * Tables that support sync.
 * Order matters for foreign key dependencies (e.g., hosts before users).
 */
export const SYNCABLE_TABLES = Object.keys(SYNCABLE_TABLE_CONFIG) as SyncableTable[];

/**
 * Tables that should be forwarded to other runners.
 * These are "shared" tables (hosts, users, mail) vs Hub-only tables (logs, costs, sessions).
 * A table is forwardable if it has host filtering (belongs to a specific host).
 */
export const FORWARDABLE_TABLES = SYNCABLE_TABLES.filter(
  (table) => SYNCABLE_TABLE_CONFIG[table].hostFilter !== "none"
) as SyncableTable[];

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
 * Build the host filter clause for a Prisma where condition.
 * Returns an object to be merged into the where clause.
 */
function buildHostFilter(
  hostFilter: HostFilterType,
  localHostId: string
): Record<string, unknown> {
  switch (hostFilter) {
    case "none":
      return {};
    case "direct_id":
      // Filter on id = localHostId (for hosts table)
      return { id: localHostId };
    case "direct_host_id":
      // Filter on host_id = localHostId (for users table)
      return { host_id: localHostId };
    case "join_user":
      // Join through users relation, check users.host_id
      return { users: { host_id: localHostId } };
    case "join_updated_by":
      // Join through updated_user relation, check updated_user.host_id
      return { updated_user: { host_id: localHostId } };
    default:
      return {};
  }
}

/**
 * Query records from a table that have been updated/created since a given timestamp.
 * For append-only tables (appendOnly: true), uses ULID-based queries (id > since_ulid).
 * For other tables, uses updated_at timestamp queries.
 * Filters records by localHostId based on the table's hostFilter configuration.
 * Returns records plus a hasMore flag for pagination.
 */
export async function queryChangedRecords(
  prisma: PrismaClient,
  table: SyncableTable,
  since: Date,
  limit: number,
  localHostId: string
): Promise<{ records: Record<string, unknown>[]; hasMore: boolean }> {
  const config = SYNCABLE_TABLE_CONFIG[table];
  const isAppendOnly = config?.appendOnly ?? false;
  const hostFilter = config?.hostFilter ?? "none";

  // Use dynamic access with any - safe because table is from our whitelist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[table];

  // Build the host filter clause
  const hostFilterClause = buildHostFilter(hostFilter, localHostId);

  let records: Record<string, unknown>[];

  if (isAppendOnly) {
    // Append-only tables: query by ULID (lexicographically sortable by time)
    const sinceUlid = timestampToUlidPrefix(since);
    records = (await model.findMany({
      where: { id: { gt: sinceUlid }, ...hostFilterClause },
      orderBy: { id: "asc" },
      take: limit + 1,
    })) as Record<string, unknown>[];
  } else {
    // Regular tables: query by updated_at
    records = (await model.findMany({
      where: { updated_at: { gt: since }, ...hostFilterClause },
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
