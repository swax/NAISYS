import { toUrlSafeKey } from "@naisys/common";
import type { HubDatabaseService } from "@naisys/hub-database";
import type { HostType } from "@naisys/hub-database";
import crypto from "node:crypto";

interface HostCacheEntry {
  hostName: string;
  machineId: string;
  restricted: boolean;
  hostType: HostType;
  lastVersion: string;
  environment: string | null;
}

export interface RegisterHostResult {
  hostId: number;
  machineId: string;
  hostName: string;
}

export async function createHostRegistrar({ hubDb }: HubDatabaseService) {
  /** Cache of all known hosts keyed by id */
  const hostsById = new Map<number, HostCacheEntry>();

  // Seed the cache from the database
  const rows = await hubDb.hosts.findMany({
    select: {
      id: true,
      name: true,
      machine_id: true,
      restricted: true,
      host_type: true,
      last_version: true,
      environment: true,
    },
  });
  for (const row of rows) {
    hostsById.set(row.id, {
      hostName: row.name,
      machineId: row.machine_id ?? "",
      restricted: row.restricted,
      hostType: row.host_type,
      lastVersion: row.last_version ?? "",
      environment: row.environment,
    });
  }

  /** Helper to update last_active and connection metadata for an existing host */
  function updateCache(
    hostId: number,
    entry: HostCacheEntry,
  ) {
    hostsById.set(hostId, entry);
  }

  /**
   * Find the next available hostname when a collision occurs.
   * E.g. "myhost" → "myhost-2", "myhost-3", etc.
   */
  async function findAvailableHostName(baseName: string): Promise<string> {
    let suffix = 2;
    while (true) {
      const candidate = `${baseName}-${suffix}`;
      const exists = await hubDb.hosts.findUnique({
        where: { name: candidate },
      });
      if (!exists) return candidate;
      suffix++;
    }
  }

  /** Register a supervisor connection. Simple name-based upsert, no machineId. */
  async function registerSupervisor(
    hostName: string,
    lastIp: string,
    clientVersion: string,
  ): Promise<RegisterHostResult> {
    hostName = toUrlSafeKey(hostName);
    const hostType: HostType = "supervisor";

    const existing = await hubDb.hosts.findUnique({
      where: { name: hostName },
    });

    if (existing) {
      await hubDb.hosts.update({
        where: { id: existing.id },
        data: {
          last_active: new Date().toISOString(),
          host_type: hostType,
          last_ip: lastIp,
          last_version: clientVersion,
        },
      });
      updateCache(existing.id, {
        hostName,
        machineId: existing.machine_id ?? "",
        restricted: existing.restricted,
        hostType,
        lastVersion: clientVersion,
        environment: existing.environment,
      });
      return { hostId: existing.id, machineId: "", hostName };
    }

    const created = await hubDb.hosts.create({
      data: {
        name: hostName,
        host_type: hostType,
        last_ip: lastIp,
        last_version: clientVersion,
        last_active: new Date().toISOString(),
      },
    });
    updateCache(created.id, {
      hostName,
      machineId: "",
      restricted: false,
      hostType,
      lastVersion: clientVersion,
      environment: null,
    });
    return { hostId: created.id, machineId: "", hostName };
  }

  /**
   * Register a NAISYS client. If machineId is provided, looks up by machineId
   * first (the DB hostname is authoritative after a rename). Otherwise looks up
   * by hostname, deduplicating with a -N suffix on collision.
   *
   * @returns The host's id, assigned machineId, and authoritative hostname
   */
  async function registerNaisysClient(
    hostName: string,
    machineId: string | undefined,
    lastIp: string,
    clientVersion: string,
    environment: Record<string, unknown> | undefined,
  ): Promise<RegisterHostResult> {
    hostName = toUrlSafeKey(hostName);
    const hostType: HostType = "naisys";
    const environmentJson = environment ? JSON.stringify(environment) : null;

    // --- Lookup by machineId (returning client) ---
    if (machineId) {
      const byMachineId = await hubDb.hosts.findUnique({
        where: { machine_id: machineId },
      });

      if (byMachineId) {
        await hubDb.hosts.update({
          where: { id: byMachineId.id },
          data: {
            last_active: new Date().toISOString(),
            host_type: hostType,
            last_ip: lastIp,
            last_version: clientVersion,
            ...(environmentJson !== null
              ? { environment: environmentJson }
              : {}),
          },
        });
        updateCache(byMachineId.id, {
          hostName: byMachineId.name,
          machineId,
          restricted: byMachineId.restricted,
          hostType,
          lastVersion: clientVersion,
          environment: environmentJson ?? byMachineId.environment,
        });
        // Return the DB hostname (may differ from what the client sent if renamed)
        return {
          hostId: byMachineId.id,
          machineId,
          hostName: byMachineId.name,
        };
      }
      // machineId not found in DB — fall through to name-based lookup
    }

    // --- Lookup by hostname ---
    const newMachineId = machineId || crypto.randomUUID();

    const byName = await hubDb.hosts.findUnique({
      where: { name: hostName },
    });

    if (byName) {
      if (!byName.machine_id) {
        // Existing host without a machineId (pre-migration) — adopt it
        await hubDb.hosts.update({
          where: { id: byName.id },
          data: {
            machine_id: newMachineId,
            last_active: new Date().toISOString(),
            host_type: hostType,
            last_ip: lastIp,
            last_version: clientVersion,
            ...(environmentJson !== null
              ? { environment: environmentJson }
              : {}),
          },
        });
        updateCache(byName.id, {
          hostName,
          machineId: newMachineId,
          restricted: byName.restricted,
          hostType,
          lastVersion: clientVersion,
          environment: environmentJson ?? byName.environment,
        });
        return { hostId: byName.id, machineId: newMachineId, hostName };
      }

      // Name collision with a different machine — deduplicate
      hostName = await findAvailableHostName(hostName);
    }

    // --- Create new host ---
    const created = await hubDb.hosts.create({
      data: {
        name: hostName,
        machine_id: newMachineId,
        host_type: hostType,
        last_ip: lastIp,
        last_version: clientVersion,
        environment: environmentJson,
        last_active: new Date().toISOString(),
      },
    });

    updateCache(created.id, {
      hostName,
      machineId: newMachineId,
      restricted: false,
      hostType,
      lastVersion: clientVersion,
      environment: environmentJson,
    });

    return { hostId: created.id, machineId: newMachineId, hostName };
  }

  /** Returns all known hosts (from DB + any newly registered) */
  function getAllHosts(): {
    hostId: number;
    hostName: string;
    machineId: string;
    restricted: boolean;
    hostType: HostType;
    lastVersion: string;
    environment: string | null;
  }[] {
    return Array.from(hostsById, ([hostId, entry]) => ({
      hostId,
      hostName: entry.hostName,
      machineId: entry.machineId,
      restricted: entry.restricted,
      hostType: entry.hostType,
      lastVersion: entry.lastVersion,
      environment: entry.environment,
    }));
  }

  /** Re-read all hosts from DB and replace the in-memory cache */
  async function refreshHosts(): Promise<void> {
    const rows = await hubDb.hosts.findMany({
      select: {
        id: true,
        name: true,
        machine_id: true,
        restricted: true,
        host_type: true,
        last_version: true,
        environment: true,
      },
    });
    hostsById.clear();
    for (const row of rows) {
      hostsById.set(row.id, {
        hostName: row.name,
        machineId: row.machine_id ?? "",
        restricted: row.restricted,
        hostType: row.host_type,
        lastVersion: row.last_version ?? "",
        environment: row.environment,
      });
    }
  }

  return {
    registerNaisysClient,
    registerSupervisor,
    getAllHosts,
    refreshHosts,
  };
}

export type HostRegistrar = Awaited<ReturnType<typeof createHostRegistrar>>;
