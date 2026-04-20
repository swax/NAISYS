/**
 * Build a Prisma timestamp-range filter for cursor pagination.
 *
 * `updatedSince` fetches newer items; `updatedBefore` fetches older items.
 * Returns `undefined` when neither bound is set, so the caller can skip
 * adding the filter to the where-clause entirely.
 *
 * Pick `sinceOp` based on what the client sends as the cursor:
 *  - `"gt"`  — when the cursor is a server-generated "now" timestamp that
 *              never collides with a row's column (e.g. runs polling sends
 *              `new Date().toISOString()`).
 *  - `"gte"` — when the cursor is a row's own timestamp (e.g. mail/chat
 *              send `newestMessage.createdAt`). `gte` re-returns the
 *              boundary row on the next poll, which is deduped client-side
 *              but protects against sub-ms timestamp collisions where two
 *              rows share `created_at` — `gt` would permanently skip the
 *              second one.
 */
export function timestampCursorWhere(
  updatedSince: string | undefined,
  updatedBefore: string | undefined,
  sinceOp: "gt" | "gte" = "gte",
): { gt?: string; gte?: string; lt?: string } | undefined {
  if (!updatedSince && !updatedBefore) return undefined;
  return {
    ...(updatedSince && { [sinceOp]: updatedSince }),
    ...(updatedBefore && { lt: updatedBefore }),
  };
}
