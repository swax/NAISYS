import { DatabaseService, ulid } from "@naisys/database";
import { HostService } from "./hostService.js";

export function createRunnerRegistrar(
  dbService: DatabaseService,
  hostService: HostService,
) {
  const hubHostId = hostService.localHostId;

  /**
   * Register a runner by name. Creates a new record if not found,
   * updates last_active on every call.
   * @returns The runner's ULID id
   */
  async function registerRunner(runnerName: string): Promise<string> {
    return await dbService.usingDatabase(async (prisma) => {
      const existing = await prisma.runners.findUnique({
        where: { name: runnerName },
      });

      if (existing) {
        await prisma.runners.update({
          where: { id: existing.id },
          data: { last_active: new Date().toISOString() },
        });
        return existing.id;
      }

      const newId = ulid();
      await prisma.runners.create({
        data: {
          id: newId,
          name: runnerName,
          host_id: hubHostId,
          last_active: new Date().toISOString(),
        },
      });

      return newId;
    });
  }

  return {
    registerRunner,
  };
}

export type RunnerRegistrar = ReturnType<typeof createRunnerRegistrar>;
