import { DatabaseService, ulid } from "@naisys/database";

export function createHostRegistrar(
  dbService: DatabaseService,
) {
  /**
   * Register a NAISYS instance by name. Creates a new record if not found,
   * updates last_active on every call.
   * @returns The host's ULID id
   */
  async function registerHost(hostName: string): Promise<string> {
    return await dbService.usingDatabase(async (prisma) => {
      const existing = await prisma.hosts.findUnique({
        where: { name: hostName },
      });

      if (existing) {
        await prisma.hosts.update({
          where: { id: existing.id },
          data: { last_active: new Date().toISOString() },
        });
        return existing.id;
      }

      const newId = ulid();
      await prisma.hosts.create({
        data: {
          id: newId,
          name: hostName,
          last_active: new Date().toISOString(),
        },
      });

      return newId;
    });
  }

  return {
    registerHost,
  };
}

export type HostRegistrar = ReturnType<typeof createHostRegistrar>;
