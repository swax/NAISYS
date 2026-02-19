// Re-export Database Config
export {
  supervisorDbPath,
  supervisorDbUrl,
  SUPERVISOR_DB_VERSION,
} from "./dbConfig.js";
// Re-export Prisma client factory
export { createPrismaClient } from "./prismaClient.js";
// Re-export Migration Helper
export { deploySupervisorMigrations } from "./migrationHelper.js";
// Re-export Session Service
export {
  createSupervisorDatabaseClient,
  authenticateAndCreateSession,
  findSession,
  lookupUsername,
  createSession,
  updateUserPassword,
  deleteSession,
  ensureSuperAdmin,
  handleResetPassword,
  resetPassword,
} from "./sessionService.js";
export type { SessionUser, AuthResult } from "./sessionService.js";
// Re-export Prisma Client and all generated types
export * from "./generated/prisma/client.js";
export { PrismaClient } from "./generated/prisma/client.js";
