import { FORWARDABLE_TABLES, type SyncableTable } from "@naisys/database";
import { HubServerLog } from "./hubServerLog.js";

/** Forward queue: table name → array of records to forward */
type ForwardQueue = Map<SyncableTable, Record<string, unknown>[]>;

/**
 * Manages forward queues for connected runners.
 * When sync data arrives from one runner, it's queued for all other runners.
 * Queues are ephemeral - cleared on disconnect, rebuilt via catch_up on reconnect.
 */
export function createHubForwardService(logService: HubServerLog) {
  /** Per-client forward queues */
  const clientQueues = new Map<string, ForwardQueue>();

  /**
   * Initialize an empty forward queue for a client.
   * Called when a client connects.
   */
  function initClient(hostId: string): void {
    clientQueues.set(hostId, new Map());
    logService.log(`[ForwardService] Initialized queue for ${hostId}`);
  }

  /**
   * Remove a client's forward queue.
   * Called when a client disconnects.
   */
  function removeClient(hostId: string): void {
    clientQueues.delete(hostId);
    logService.log(`[ForwardService] Removed queue for ${hostId}`);
  }

  /**
   * Check if a client has a forward queue (is connected).
   */
  function hasClient(hostId: string): boolean {
    return clientQueues.has(hostId);
  }

  /**
   * Enqueue sync data from one client for all other connected clients.
   * Filters to forwardable tables only.
   *
   * @param sourceHostId - The host that sent the sync data (excluded from forwarding)
   * @param tables - The sync data, keyed by table name
   */
  function enqueueForOtherClients(
    sourceHostId: string,
    tables: Record<string, Record<string, unknown>[]>
  ): void {
    // Filter to forwardable tables and non-empty arrays
    const forwardableTables = Object.entries(tables).filter(
      ([table, records]) =>
        FORWARDABLE_TABLES.includes(table as SyncableTable) &&
        records.length > 0
    );

    if (forwardableTables.length === 0) {
      return; // Nothing to forward
    }

    // Count total records being forwarded
    const totalRecords = forwardableTables.reduce(
      (sum, [, records]) => sum + records.length,
      0
    );

    // Get all other connected clients
    const targetClients = Array.from(clientQueues.keys()).filter(
      (hostId) => hostId !== sourceHostId
    );

    if (targetClients.length === 0) {
      logService.log(
        `[ForwardService] No other clients to forward ${totalRecords} records to`
      );
      return;
    }

    logService.log(
      `[ForwardService] Queuing ${totalRecords} records from ${sourceHostId} for ${targetClients.length} clients`
    );

    // Enqueue for each target client
    for (const targetHostId of targetClients) {
      const queue = clientQueues.get(targetHostId);
      if (!queue) continue;

      for (const [table, records] of forwardableTables) {
        const tableKey = table as SyncableTable;
        const existing = queue.get(tableKey) ?? [];
        queue.set(tableKey, [...existing, ...records]);
      }
    }
  }

  /**
   * Dequeue and return all pending forwards for a client.
   * Clears the queue after returning.
   *
   * @param hostId - The client to get forwards for
   * @returns Object with table name → records, or undefined if empty
   */
  function dequeueForClient(
    hostId: string
  ): Record<string, Record<string, unknown>[]> | undefined {
    const queue = clientQueues.get(hostId);
    if (!queue || queue.size === 0) {
      return undefined;
    }

    // Convert queue to plain object
    const forwards: Record<string, Record<string, unknown>[]> = {};
    let totalRecords = 0;

    for (const [table, records] of queue) {
      if (records.length > 0) {
        forwards[table] = records;
        totalRecords += records.length;
      }
    }

    if (totalRecords === 0) {
      return undefined;
    }

    // Clear the queue
    queue.clear();

    logService.log(
      `[ForwardService] Dequeued ${totalRecords} records for ${hostId}`
    );

    return forwards;
  }

  /**
   * Get the number of pending forwards for a client.
   * Useful for debugging/monitoring.
   */
  function getPendingCount(hostId: string): number {
    const queue = clientQueues.get(hostId);
    if (!queue) return 0;

    let count = 0;
    for (const records of queue.values()) {
      count += records.length;
    }
    return count;
  }

  /**
   * Get list of all clients with forward queues.
   */
  function getClients(): string[] {
    return Array.from(clientQueues.keys());
  }

  return {
    initClient,
    removeClient,
    hasClient,
    enqueueForOtherClients,
    dequeueForClient,
    getPendingCount,
    getClients,
  };
}

export type HubForwardService = ReturnType<typeof createHubForwardService>;
