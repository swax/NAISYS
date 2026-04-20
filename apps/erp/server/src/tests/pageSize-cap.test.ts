/**
 * Verifies that all list-endpoint query schemas silently clamp pageSize
 * to MAX_PAGE_SIZE (the documented cap), rather than rejecting with an
 * error or producing a malformed response.
 *
 * Regression: previously, callers who passed pageSize=200 received
 * `{ items: null, total: null }` because the schema's .max(100) refinement
 * rejected the value but the response shape was still attempted.
 */
import {
  AdminAttachmentListRequestSchema,
  DispatchListQuerySchema,
  InventoryListQuerySchema,
  ItemInstanceListQuerySchema,
  ItemListQuerySchema,
  MAX_PAGE_SIZE,
  OrderListQuerySchema,
  OrderRevisionListQuerySchema,
  OrderRunListQuerySchema,
  UserListQuerySchema,
  WorkCenterListQuerySchema,
} from "@naisys/erp-shared";
import { describe, expect, test } from "vitest";

const LIST_QUERY_SCHEMAS = {
  DispatchListQuerySchema,
  InventoryListQuerySchema,
  ItemInstanceListQuerySchema,
  ItemListQuerySchema,
  OrderListQuerySchema,
  OrderRevisionListQuerySchema,
  OrderRunListQuerySchema,
  UserListQuerySchema,
  WorkCenterListQuerySchema,
  AdminAttachmentListRequestSchema,
} as const;

describe("pageSize cap behaviour", () => {
  test("MAX_PAGE_SIZE is 100", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  for (const [name, schema] of Object.entries(LIST_QUERY_SCHEMAS)) {
    describe(name, () => {
      test("oversized pageSize is silently clamped to MAX_PAGE_SIZE", () => {
        const result = schema.parse({ pageSize: 200 });
        expect(result.pageSize).toBe(MAX_PAGE_SIZE);
      });

      test("string pageSize from query string is coerced and clamped", () => {
        const result = schema.parse({ pageSize: "9999" });
        expect(result.pageSize).toBe(MAX_PAGE_SIZE);
      });

      test("pageSize within range is preserved", () => {
        const result = schema.parse({ pageSize: 50 });
        expect(result.pageSize).toBe(50);
      });

      test("pageSize at exact cap is preserved", () => {
        const result = schema.parse({ pageSize: MAX_PAGE_SIZE });
        expect(result.pageSize).toBe(MAX_PAGE_SIZE);
      });

      test("default pageSize is applied when omitted", () => {
        const result = schema.parse({});
        expect(typeof result.pageSize).toBe("number");
        expect(result.pageSize).toBeGreaterThanOrEqual(1);
        expect(result.pageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      });

      test("pageSize < 1 is rejected", () => {
        expect(() => schema.parse({ pageSize: 0 })).toThrow();
      });
    });
  }
});
