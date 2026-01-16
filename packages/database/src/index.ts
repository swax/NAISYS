// Re-export Prisma Client and all generated types
export { PrismaClient } from "./generated/prisma/client.js";
export * from "./generated/prisma/client.js";

// Re-export ULID utilities
export { ulid, monotonicFactory, decodeTime } from "ulid";

// Re-export Prisma client factory
export { createPrismaClient } from "./prismaClient.js";

// Re-export Database Service
export { createDatabaseService, DatabaseService } from "./dbService.js";

// Re-export Sync Utilities
export {
  countRecordsInTables,
  findMaxUpdatedAt,
  findMaxUpdatedAtFromTables,
  loadSyncState,
  saveSyncState,
  serializeRecord,
  serializeRecords,
  queryChangedRecords,
  queryCatchUpRecords,
  upsertRecord,
  upsertRecords,
  SYNCABLE_TABLES,
  SYNCABLE_TABLE_CONFIG,
  FORWARDABLE_TABLES,
  type SyncableTable,
  type UpsertOptions,
} from "./syncUtils.js";
