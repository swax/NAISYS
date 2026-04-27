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
export type {
  AuthResult,
  EnsureSuperAdminResult,
  SessionUser,
} from "./sessionService.js";
export {
  createSessionForUser,
  createSupervisorDatabaseClient,
  deleteAllSessionsForUser,
  deleteSession,
  ensureSuperAdmin,
  findSession,
  findUserByApiKey,
  getSupervisorDb,
} from "./sessionService.js";
// Re-export Passkey / Registration Service
export type {
  ConsumeAndStoreInput,
  ConsumeAndStoreResult,
  PasskeyCredentialRecord,
  PasskeyCredentialSummary,
} from "./passkeyService.js";
export {
  consumeTokenAndStoreCredential,
  createPasskeyCredential,
  deleteAllPasskeyCredentialsForUser,
  deletePasskeyCredential,
  findPasskeyCredentialByCredentialId,
  hasActiveRegistrationToken,
  issueRegistrationToken,
  listPasskeyCredentialIdsForUser,
  listPasskeyCredentialsForUser,
  lookupRegistrationToken,
  updatePasskeyCounter,
  userHasPasskey,
} from "./passkeyService.js";
// Re-export Prisma Client and all generated types
export * from "./generated/prisma/client.js";
export { PrismaClient } from "./generated/prisma/client.js";
