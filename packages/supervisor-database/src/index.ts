// Re-export Database Config
export {
  SUPERVISOR_DB_VERSION,
  supervisorDbPath,
  supervisorDbUrl,
} from "./dbConfig.js";
// Re-export Prisma client factory
export { createPrismaClient } from "./prismaClient.js";
// Re-export Migration Helper
export { deploySupervisorMigrations } from "./migrationHelper.js";
// Re-export Session Service
export type { AuthResult,SessionUser } from "./sessionService.js";
export {
  authenticateAndCreateSession,
  createSession,
  createSupervisorDatabaseClient,
  deleteSession,
  ensureSuperAdmin,
  findSession,
  handleResetPassword,
  lookupUsername,
  resetPassword,
  updateUserPassword,
} from "./sessionService.js";
// Re-export Prisma Client and all generated types
export * from "./generated/prisma/client.js";
export { PrismaClient } from "./generated/prisma/client.js";
