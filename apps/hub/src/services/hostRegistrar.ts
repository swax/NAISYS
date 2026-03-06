import { toUrlSafeKey } from "@naisys/common";
import type { HubDatabaseService } from "@naisys/hub-database";

export async function createHostRegistrar({ hubDb }: HubDatabaseService) {
  /** Cache of all known hosts keyed by id */
  const hostsById = new Map<
    number,
    { hostName: string; restricted: boolean; hostType: string }
  >();

  // Seed the cache from the database
  const rows = await hubDb.hosts.findMany({
    select: { id: true, name: true, restricted: true, host_type: true },
  });
  for (const row of rows) {
    hostsById.set(row.id, {
      hostName: row.name,
      restricted: row.restricted,
      hostType: row.host_type,
    });
  }

  /**
   * Register a NAISYS instance by name. Creates a new record if not found,
   * updates last_active on every call.
   * @returns The host's autoincrement id
   */
  async function registerHost(
    hostName: string,
    hostType: string,
  ): Promise<number> {
    hostName = toUrlSafeKey(hostName);

    const existing = await hubDb.hosts.findUnique({
      where: { name: hostName },
    });

    if (existing) {
      await hubDb.hosts.update({
        where: { id: existing.id },
        data: { last_active: new Date().toISOString(), host_type: hostType },
      });
      hostsById.set(existing.id, {
        hostName,
        restricted: existing.restricted,
        hostType,
      });
      return existing.id;
    }

    const created = await hubDb.hosts.create({
      data: {
        name: hostName,
        host_type: hostType,
        last_active: new Date().toISOString(),
      },
    });

    hostsById.set(created.id, { hostName, restricted: false, hostType });

    return created.id;
  }

  /** Returns all known hosts (from DB + any newly registered) */
  function getAllHosts(): {
    hostId: number;
    hostName: string;
    restricted: boolean;
    hostType: string;
  }[] {
    return Array.from(hostsById, ([hostId, entry]) => ({
      hostId,
      hostName: entry.hostName,
      restricted: entry.restricted,
      hostType: entry.hostType,
    }));
  }

  /** Re-read all hosts from DB and replace the in-memory cache */
  async function refreshHosts(): Promise<void> {
    const rows = await hubDb.hosts.findMany({
      select: { id: true, name: true, restricted: true, host_type: true },
    });
    hostsById.clear();
    for (const row of rows) {
      hostsById.set(row.id, {
        hostName: row.name,
        restricted: row.restricted,
        hostType: row.host_type,
      });
    }
  }

  return {
    registerHost,
    getAllHosts,
    refreshHosts,
  };
}

export type HostRegistrar = Awaited<ReturnType<typeof createHostRegistrar>>;
