import type { MailPush } from "@naisys/hub-protocol";

/** Discriminated union for events pushed to mail/chat browser rooms */
export type MessageRoomEvent =
  | ({
      type: "new-message";
      /** ID of the previous message pushed to this room, null if unknown */
      previousMessageId: number | null;
    } & MailPush)
  | { type: "read-receipt"; messageIds: number[]; userId: number };

interface MergeCacheItem {
  id: number;
  createdAt: string;
}

/**
 * Merge new items into a module-level cache by id, update total and
 * updatedSince tracking. Returns true if the cache changed.
 */
export function mergeIntoCache<K, T extends MergeCacheItem>(
  key: K,
  newItems: T[],
  total: number | undefined,
  itemCache: Map<K, T[]>,
  totalCache: Map<K, number>,
  updatedSinceCache: Map<K, string | undefined>,
  newestFirst: boolean,
): boolean {
  if (newItems.length === 0 && total === undefined) return false;

  const existing = itemCache.get(key) || [];
  const mergeMap = new Map(existing.map((m) => [m.id, m]));

  const existingCount = mergeMap.size;
  for (const item of newItems) {
    mergeMap.set(item.id, item);
  }

  const merged = Array.from(mergeMap.values());
  const newCount = merged.length - existingCount;

  merged.sort((a, b) => {
    const diff =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return newestFirst ? -diff : diff;
  });

  itemCache.set(key, merged);

  if (total !== undefined) {
    totalCache.set(key, total);
  } else if (newCount > 0) {
    totalCache.set(key, (totalCache.get(key) || 0) + newCount);
  }

  // Use the latest server timestamp from merged items rather than client time.
  // This ensures updatedSince tracks actual message times and isn't affected
  // by client/server clock skew, so missed messages stay recoverable.
  if (merged.length > 0) {
    const newest = newestFirst ? merged[0] : merged[merged.length - 1];
    updatedSinceCache.set(key, newest.createdAt);
  }
  return true;
}
