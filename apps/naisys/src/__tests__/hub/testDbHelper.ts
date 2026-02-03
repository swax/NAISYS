import {
  createDatabaseService,
  createPrismaClient,
  PrismaClient,
  type DatabaseService,
} from "@naisys/database";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Test database helper for creating isolated SQLite databases for integration tests.
 * Each test run gets fresh databases that are cleaned up afterward.
 */

export interface TestDatabase {
  dbService: DatabaseService;
  prisma: PrismaClient;
  folder: string;
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated test database with migrations applied.
 * Returns the database service and a cleanup function.
 *
 * @param name - Name prefix for the database (e.g., "naisys-a", "hub")
 */
export async function createTestDatabase(
  name: string,
  dbType: string,
): Promise<TestDatabase> {
  // Create a unique temp directory for this test database
  const folder = mkdtempSync(join(tmpdir(), `naisys-test-${name}-`));

  // Create database service (runs migrations)
  const dbService = await createDatabaseService(folder);

  // Create a direct Prisma client for assertions
  const dbPath = join(folder, "database", `naisys_hub.sqlite`);
  const prisma = createPrismaClient(dbPath);

  const cleanup = async () => {
    // Close both Prisma connections and remove temp directory
    await Promise.all([
      dbService.disconnect().catch(() => {}),
      prisma.$disconnect().catch(() => {}),
    ]);
    // Small delay for Windows to release file handles
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true });
    }
  };

  return { dbService, prisma, folder, cleanup };
}

/**
 * Create a set of test databases for a full E2E test scenario.
 * Returns databases for two NAISYS instances and one hub.
 */
export async function createTestDatabaseSet(): Promise<{
  naisysA: TestDatabase;
  naisysB: TestDatabase;
  hub: TestDatabase;
  cleanupAll: () => Promise<void>;
}> {
  const [naisysA, naisysB, hub] = await Promise.all([
    createTestDatabase("naisys-a", "naisys"),
    createTestDatabase("naisys-b", "naisys"),
    createTestDatabase("hub", "hub"),
  ]);

  const cleanupAll = async () => {
    await Promise.all([naisysA.cleanup(), naisysB.cleanup(), hub.cleanup()]);
  };

  return { naisysA, naisysB, hub, cleanupAll };
}

/**
 * Helper to seed a host record in a database.
 */
export async function seedHost(
  prisma: PrismaClient,
  hostId: string,
  name: string,
): Promise<void> {
  await prisma.hosts.upsert({
    where: { id: hostId },
    update: { name },
    create: { id: hostId, name },
  });
}

/**
 * Helper to seed a user record in a database.
 */
export async function seedUser(
  prisma: PrismaClient,
  id: string,
  username: string,
): Promise<void> {
  await prisma.users.upsert({
    where: { id },
    update: { username },
    create: {
      id,
      username,
      title: "Test User",
      agent_path: `/agents/${username}.yaml`,
    },
  });
}

/**
 * Reset all tables in a database (delete all data but keep schema).
 * Useful for resetting state between tests without recreating the database.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // Delete in order to respect foreign key constraints
  await prisma.context_log.deleteMany();
  await prisma.run_session.deleteMany();
  await prisma.costs.deleteMany();
  await prisma.mail_recipients.deleteMany();
  await prisma.mail_messages.deleteMany();
  await prisma.user_notifications.deleteMany();
  await prisma.user_hosts.deleteMany();
  await prisma.users.deleteMany();
  await prisma.hosts.deleteMany();
}
