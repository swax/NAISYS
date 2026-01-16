import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDatabaseService,
  createPrismaClient,
  PrismaClient,
  type DatabaseService,
} from "@naisys/database";

/**
 * Test database helper for creating isolated SQLite databases for integration tests.
 * Each test run gets fresh databases that are cleaned up afterward.
 */

export interface TestDatabase {
  dbService: DatabaseService;
  prisma: PrismaClient;
  folder: string;
  cleanup: () => void;
}

/**
 * Create an isolated test database with migrations applied.
 * Returns the database service and a cleanup function.
 *
 * @param name - Name prefix for the database (e.g., "runner-a", "hub")
 */
export async function createTestDatabase(
  name: string,
  dbType: "naisys" | "hub" = "naisys"
): Promise<TestDatabase> {
  // Create a unique temp directory for this test database
  const folder = mkdtempSync(join(tmpdir(), `naisys-test-${name}-`));

  // Create database service (runs migrations)
  const dbService = await createDatabaseService(folder, dbType);

  // Create a direct Prisma client for assertions
  const dbPath = join(folder, "database", `${dbType}.sqlite`);
  const prisma = createPrismaClient(dbPath);

  const cleanup = () => {
    // Close Prisma connection and remove temp directory
    prisma.$disconnect().catch(() => {});
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true });
    }
  };

  return { dbService, prisma, folder, cleanup };
}

/**
 * Create a set of test databases for a full E2E test scenario.
 * Returns databases for two runners and one hub.
 */
export async function createTestDatabaseSet(): Promise<{
  runnerA: TestDatabase;
  runnerB: TestDatabase;
  hub: TestDatabase;
  cleanupAll: () => void;
}> {
  const [runnerA, runnerB, hub] = await Promise.all([
    createTestDatabase("runner-a", "naisys"),
    createTestDatabase("runner-b", "naisys"),
    createTestDatabase("hub", "hub"),
  ]);

  const cleanupAll = () => {
    runnerA.cleanup();
    runnerB.cleanup();
    hub.cleanup();
  };

  return { runnerA, runnerB, hub, cleanupAll };
}

/**
 * Helper to seed a host record in a database.
 */
export async function seedHost(
  prisma: PrismaClient,
  id: string,
  name: string
): Promise<void> {
  await prisma.hosts.upsert({
    where: { id },
    update: { name },
    create: { id, name },
  });
}

/**
 * Helper to seed a user record in a database.
 */
export async function seedUser(
  prisma: PrismaClient,
  id: string,
  username: string,
  hostId: string
): Promise<void> {
  await prisma.users.upsert({
    where: { id },
    update: { username, host_id: hostId },
    create: {
      id,
      username,
      title: "Test User",
      agent_path: `/agents/${username}.yaml`,
      host_id: hostId,
    },
  });
}
