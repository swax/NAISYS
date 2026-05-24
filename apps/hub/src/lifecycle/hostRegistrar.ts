import { createHash } from "node:crypto";

import type { HubDatabaseService } from "@naisys/hub-database";
import type { HostType } from "@naisys/hub-database";

interface HostCacheEntry {
  hostName: string;
  restricted: boolean;
  hostType: HostType;
  lastVersion: string;
  environment: string | null;
}

export interface ResolvedHost {
  hostId: number;
  hostName: string;
  hostType: HostType;
  restricted: boolean;
}

/** SHA-256 hex — the form stored in `hosts.access_key_hash`. */
export function hashAccessKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function createHostRegistrar({ hubDb }: HubDatabaseService) {
  const hostsById = new Map<number, HostCacheEntry>();

  async function reloadCache(): Promise<void> {
    const rows = await hubDb.hosts.findMany({
      select: {
        id: true,
        name: true,
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
        restricted: row.restricted,
        hostType: row.host_type,
        lastVersion: row.last_version ?? "",
        environment: row.environment,
      });
    }
  }

  await reloadCache();

  async function resolveByAccessKey(
    accessKey: string,
  ): Promise<ResolvedHost | null> {
    const row = await hubDb.hosts.findUnique({
      where: { access_key_hash: hashAccessKey(accessKey) },
      select: {
        id: true,
        name: true,
        host_type: true,
        restricted: true,
      },
    });
    if (!row) return null;
    return {
      hostId: row.id,
      hostName: row.name,
      hostType: row.host_type,
      restricted: row.restricted,
    };
  }

  /**
   * Stamps connection metadata and upserts the cache so hosts added after
   * registrar startup still surface in the next HOSTS_UPDATED broadcast.
   */
  async function markActive(
    resolved: ResolvedHost,
    lastIp: string,
    clientVersion: string,
    environment: Record<string, unknown> | undefined,
  ): Promise<void> {
    const environmentJson = environment ? JSON.stringify(environment) : null;

    await hubDb.hosts.update({
      where: { id: resolved.hostId },
      data: {
        last_active: new Date().toISOString(),
        last_ip: lastIp,
        last_version: clientVersion,
        ...(environmentJson !== null ? { environment: environmentJson } : {}),
      },
    });

    const existing = hostsById.get(resolved.hostId);
    hostsById.set(resolved.hostId, {
      hostName: resolved.hostName,
      restricted: resolved.restricted,
      hostType: resolved.hostType,
      lastVersion: clientVersion,
      environment: environmentJson ?? existing?.environment ?? null,
    });
  }

  function getAllHosts(): {
    hostId: number;
    hostName: string;
    restricted: boolean;
    hostType: HostType;
    lastVersion: string;
    environment: string | null;
  }[] {
    return Array.from(hostsById, ([hostId, entry]) => ({
      hostId,
      hostName: entry.hostName,
      restricted: entry.restricted,
      hostType: entry.hostType,
      lastVersion: entry.lastVersion,
      environment: entry.environment,
    }));
  }

  return {
    resolveByAccessKey,
    markActive,
    getAllHosts,
    refreshHosts: reloadCache,
  };
}

export type HostRegistrar = Awaited<ReturnType<typeof createHostRegistrar>>;
