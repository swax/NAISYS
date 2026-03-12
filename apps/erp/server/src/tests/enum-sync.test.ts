import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ErpPermissionEnum,
  OperationRunStatusEnum,
  OrderRunPriorityEnum,
  OrderRunStatusEnum,
  OrderStatusEnum,
  RevisionStatusEnum,
  StepFieldTypeEnum,
} from "@naisys-erp/shared";

import {
  ErpPermission as DbErpPermission,
  OperationRunStatus as DbOperationRunStatus,
  OrderRunPriority as DbOrderRunPriority,
  OrderRunStatus as DbOrderRunStatus,
  OrderStatus as DbOrderStatus,
  RevisionStatus as DbRevisionStatus,
  StepFieldType as DbStepFieldType,
} from "../generated/prisma/enums.js";

function assertEnumSync(
  name: string,
  sharedOptions: readonly string[],
  dbValues: Record<string, string>,
) {
  const shared = [...sharedOptions].sort();
  const db = Object.values(dbValues).sort();

  assert.deepStrictEqual(
    shared,
    db,
    `${name} enums are out of sync.\n` +
      `  Shared: [${shared.join(", ")}]\n` +
      `  DB:     [${db.join(", ")}]`,
  );
}

void describe("shared enums match database enums", () => {
  void test("ErpPermission", () => {
    assertEnumSync("ErpPermission", ErpPermissionEnum.options, DbErpPermission);
  });

  void test("OrderStatus", () => {
    assertEnumSync("OrderStatus", OrderStatusEnum.options, DbOrderStatus);
  });

  void test("RevisionStatus", () => {
    assertEnumSync(
      "RevisionStatus",
      RevisionStatusEnum.options,
      DbRevisionStatus,
    );
  });

  void test("OrderRunStatus", () => {
    assertEnumSync(
      "OrderRunStatus",
      OrderRunStatusEnum.options,
      DbOrderRunStatus,
    );
  });

  void test("OrderRunPriority", () => {
    assertEnumSync(
      "OrderRunPriority",
      OrderRunPriorityEnum.options,
      DbOrderRunPriority,
    );
  });

  void test("OperationRunStatus", () => {
    assertEnumSync(
      "OperationRunStatus",
      OperationRunStatusEnum.options,
      DbOperationRunStatus,
    );
  });

  void test("StepFieldType", () => {
    assertEnumSync("StepFieldType", StepFieldTypeEnum.options, DbStepFieldType);
  });
});
