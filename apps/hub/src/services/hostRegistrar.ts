import type { HubDatabaseService } from "@naisys/hub-database";

export async function createHostRegistrar({
  usingHubDatabase,
}: HubDatabaseService) {
  /** Cache of all known hosts keyed by id */
  const hostsById = new Map<
    number,
    { hostName: string; restricted: boolean }
  >();

  // Seed the cache from the database
  await usingHubDatabase(async (hubDb) => {
    const rows = await hubDb.hosts.findMany({
      select: { id: true, name: true, restricted: true },
    });
    for (const row of rows) {
      hostsById.set(row.id, { hostName: row.name, restricted: row.restricted });
    }
  });

  /**
   * Register a NAISYS instance by name. Creates a new record if not found,
   * updates last_active on every call.
   * @returns The host's autoincrement id
   */
  async function registerHost(hostName: string): Promise<number> {
    return await usingHubDatabase(async (hubDb) => {
      const existing = await hubDb.hosts.findUnique({
        where: { name: hostName },
      });

      if (existing) {
        await hubDb.hosts.update({
          where: { id: existing.id },
          data: { last_active: new Date().toISOString() },
        });
        hostsById.set(existing.id, {
          hostName,
          restricted: existing.restricted,
        });
        return existing.id;
      }

      const created = await hubDb.hosts.create({
        data: {
          name: hostName,
          last_active: new Date().toISOString(),
        },
      });

      hostsById.set(created.id, { hostName, restricted: false });

      return created.id;
    });
  }

  /** Returns all known hosts (from DB + any newly registered) */
  function getAllHosts(): {
    hostId: number;
    hostName: string;
    restricted: boolean;
  }[] {
    return Array.from(hostsById, ([hostId, entry]) => ({
      hostId,
      hostName: entry.hostName,
      restricted: entry.restricted,
    }));
  }

  /** Re-read all hosts from DB and replace the in-memory cache */
  async function refreshHosts(): Promise<void> {
    await usingHubDatabase(async (hubDb) => {
      const rows = await hubDb.hosts.findMany({
        select: { id: true, name: true, restricted: true },
      });
      hostsById.clear();
      for (const row of rows) {
        hostsById.set(row.id, { hostName: row.name, restricted: row.restricted });
      }
    });
  }

  return {
    registerHost,
    getAllHosts,
    refreshHosts,
  };
}

export type HostRegistrar = Awaited<ReturnType<typeof createHostRegistrar>>;
