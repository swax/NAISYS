import {
  ErpPermissionEnum,
  OperationRunStatusEnum,
  OrderRunPriorityEnum,
  OrderRunStatusEnum,
  OrderStatusEnum,
  RevisionStatusEnum,
  FieldTypeEnum,
} from "@naisys-erp/shared";
import { describe, expect, test } from "vitest";

import {
  ErpPermission as DbErpPermission,
  OperationRunStatus as DbOperationRunStatus,
  OrderRunPriority as DbOrderRunPriority,
  OrderRunStatus as DbOrderRunStatus,
  OrderStatus as DbOrderStatus,
  RevisionStatus as DbRevisionStatus,
  FieldType as DbFieldType,
} from "../generated/prisma/enums.js";

function assertEnumSync(
  name: string,
  sharedOptions: readonly string[],
  dbValues: Record<string, string>,
) {
  const shared = [...sharedOptions].sort();
  const db = Object.values(dbValues).sort();

  expect(shared, `${name} enums are out of sync`).toEqual(db);
}

describe("shared enums match database enums", () => {
  test("ErpPermission", () => {
    assertEnumSync("ErpPermission", ErpPermissionEnum.options, DbErpPermission);
  });

  test("OrderStatus", () => {
    assertEnumSync("OrderStatus", OrderStatusEnum.options, DbOrderStatus);
  });

  test("RevisionStatus", () => {
    assertEnumSync(
      "RevisionStatus",
      RevisionStatusEnum.options,
      DbRevisionStatus,
    );
  });

  test("OrderRunStatus", () => {
    assertEnumSync(
      "OrderRunStatus",
      OrderRunStatusEnum.options,
      DbOrderRunStatus,
    );
  });

  test("OrderRunPriority", () => {
    assertEnumSync(
      "OrderRunPriority",
      OrderRunPriorityEnum.options,
      DbOrderRunPriority,
    );
  });

  test("OperationRunStatus", () => {
    assertEnumSync(
      "OperationRunStatus",
      OperationRunStatusEnum.options,
      DbOperationRunStatus,
    );
  });

  test("FieldType", () => {
    assertEnumSync("FieldType", FieldTypeEnum.options, DbFieldType);
  });
});
