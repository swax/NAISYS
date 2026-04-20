import { z } from "zod/v4";

/**
 * Maximum allowed pageSize for any list endpoint.
 *
 * Callers may request a larger pageSize, but it will be silently clamped
 * to this value. This is documented in the OpenAPI spec via the schema
 * description so callers can discover the limit.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Build a `pageSize` query-param schema with a documented cap.
 *
 * Behaviour:
 *  - Coerces strings → numbers (querystrings are always strings).
 *  - Rejects values < 1 (floor of 1, then defaults).
 *  - Silently clamps oversized values to {@link MAX_PAGE_SIZE}.
 *  - Defaults to {@link defaultValue} when omitted.
 *
 * Apply via the shared {@link paginationQuery} helper rather than per-route.
 */
export function pageSizeSchema(defaultValue = 20) {
  return z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(defaultValue)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE))
    .describe(
      `Items per page. Values above ${MAX_PAGE_SIZE} are silently clamped to ${MAX_PAGE_SIZE}.`,
    );
}

/**
 * Page-number schema — coerced int >= 1, defaulting to 1.
 */
export function pageSchema() {
  return z.coerce.number().int().min(1).optional().default(1);
}

/**
 * Standard pagination query fields. Spread into a list-query Zod object:
 *
 * ```ts
 * export const InventoryListQuerySchema = z.object({
 *   ...paginationQuery(),
 *   search: z.string().optional(),
 * });
 * ```
 */
export function paginationQuery(defaultPageSize = 20) {
  return {
    page: pageSchema(),
    pageSize: pageSizeSchema(defaultPageSize),
  };
}
