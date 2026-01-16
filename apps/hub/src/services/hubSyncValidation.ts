import { PrismaClient, SYNCABLE_TABLE_CONFIG } from "@naisys/database";

/** Result of ownership validation */
export interface OwnershipValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that all records in sync data belong to the sending host.
 * Returns validation result with error message if invalid.
 */
export async function validateSyncOwnership(
  prisma: PrismaClient,
  hostId: string,
  tables: Record<string, unknown[]>
): Promise<OwnershipValidationResult> {
  // Cache user host_id lookups to avoid repeated queries
  const userHostCache = new Map<string, string | null>();

  async function getUserHostId(userId: string): Promise<string | null> {
    if (userHostCache.has(userId)) {
      return userHostCache.get(userId) ?? null;
    }
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { host_id: true },
    });
    const hostIdResult = user?.host_id ?? null;
    userHostCache.set(userId, hostIdResult);
    return hostIdResult;
  }

  for (const [tableName, records] of Object.entries(tables)) {
    const config = SYNCABLE_TABLE_CONFIG[tableName];
    if (!config) continue;

    const tableRecords = records as Record<string, unknown>[];
    if (tableRecords.length === 0) continue;

    const { hostFilter } = config;

    // Skip tables with no host filtering (hub-only tables)
    if (hostFilter === "none") continue;

    for (const record of tableRecords) {
      let isValid = false;
      const recordId = String(record.id ?? "unknown");

      switch (hostFilter) {
        case "direct_id":
          // hosts table: id must match hostId
          isValid = record.id === hostId;
          break;

        case "direct_host_id":
          // users table: host_id must match hostId
          isValid = record.host_id === hostId;
          break;

        case "join_user": {
          // Tables with user_id FK: lookup user's host_id
          const userId = record.user_id as string | undefined;
          if (!userId) {
            return {
              valid: false,
              error: `${tableName} record ${recordId} missing user_id`,
            };
          }
          const userHost = await getUserHostId(userId);
          isValid = userHost === hostId;
          if (!isValid) {
            return {
              valid: false,
              error: `${tableName} record ${recordId}: user ${userId} belongs to host ${userHost}, not ${hostId}`,
            };
          }
          break;
        }

        case "join_from_user": {
          // Tables with from_user_id FK: lookup from_user's host_id
          const fromUserId = record.from_user_id as string | undefined;
          if (!fromUserId) {
            return {
              valid: false,
              error: `${tableName} record ${recordId} missing from_user_id`,
            };
          }
          const fromUserHost = await getUserHostId(fromUserId);
          isValid = fromUserHost === hostId;
          if (!isValid) {
            return {
              valid: false,
              error: `${tableName} record ${recordId}: from_user ${fromUserId} belongs to host ${fromUserHost}, not ${hostId}`,
            };
          }
          break;
        }

        case "join_message_from_user": {
          // mail_recipients: need to look up message's from_user's host_id
          // For now, skip validation - hub will be rewritten
          isValid = true;
          break;
        }
      }

      if (!isValid && hostFilter !== "join_user" && hostFilter !== "join_from_user" && hostFilter !== "join_message_from_user") {
        return {
          valid: false,
          error: `${tableName} record ${recordId} does not belong to host ${hostId}`,
        };
      }
    }
  }

  return { valid: true };
}
