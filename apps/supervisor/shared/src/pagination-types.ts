import { z } from "zod";

/**
 * Standard timestamp-cursor pagination query fields.
 *
 * Used by list endpoints that support both live-tailing (updatedSince) and
 * backward pagination (updatedBefore), plus offset-style page/count within
 * the filtered range.
 *
 * ```ts
 * export const RunsDataRequestSchema = z.object({
 *   ...timestampPagingQuery(),
 * });
 * ```
 */
export function timestampPagingQuery(defaultCount = 50) {
  return {
    updatedSince: z.string().optional(),
    updatedBefore: z.string().optional(),
    page: z.coerce.number().optional().default(1),
    count: z.coerce.number().optional().default(defaultCount),
  };
}
