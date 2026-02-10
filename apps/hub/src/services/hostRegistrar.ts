import { DatabaseService } from "@naisys/database";

export async function createHostRegistrar(dbService: DatabaseService) {
  /** Cache of all known hosts keyed by id */
  const hostsById = new Map<number, string>();

  // Seed the cache from the database
  await dbService.usingDatabase(async (prisma) => {
    const rows = await prisma.hosts.findMany({
      select: { id: true, name: true },
    });
    for (const row of rows) {
      hostsById.set(row.id, row.name);
    }
  });

  /**
   * Register a NAISYS instance by name. Creates a new record if not found,
   * updates last_active on every call.
   * @returns The host's autoincrement id
   */
  async function registerHost(hostName: string): Promise<number> {
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

      const created = await prisma.hosts.create({
        data: {
          name: hostName,
          last_active: new Date().toISOString(),
        },
      });

      hostsById.set(created.id, hostName);

      return created.id;
    });
  }

  /** Returns all known hosts (from DB + any newly registered) */
  function getAllHosts(): { hostId: number; hostName: string }[] {
    return Array.from(hostsById, ([hostId, hostName]) => ({
      hostId,
      hostName,
    }));
  }

  return {
    registerHost,
    getAllHosts,
  };
}

export type HostRegistrar = Awaited<ReturnType<typeof createHostRegistrar>>;
