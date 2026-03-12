import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AttachmentPurpose as DbAttachmentPurpose,
  ContextLogRole as DbContextLogRole,
  ContextLogSource as DbContextLogSource,
  ContextLogType as DbContextLogType,
  CostSource as DbCostSource,
  HostType as DbHostType,
  MessageKind as DbMessageKind,
  ModelType as DbModelType,
  RecipientType as DbRecipientType,
} from "@naisys/hub-database";
import {
  AttachmentPurposeEnum,
  CostSourceEnum,
  HostTypeEnum,
  LogRoleEnum,
  LogSourceEnum,
  LogTypeEnum,
  MessageKindSchema,
} from "@naisys/hub-protocol";
import {
  LogRoleSchema,
  LogSourceSchema,
  LogTypeSchema,
  ModelTypeEnum,
  RecipientTypeEnum,
} from "@naisys-supervisor/shared";

function assertEnumSync(
  name: string,
  zodOptions: readonly string[],
  dbValues: string[],
) {
  const shared = [...zodOptions].sort();
  const db = [...dbValues].sort();
  assert.deepStrictEqual(
    shared,
    db,
    `${name} enums are out of sync.\n` +
      `  Shared: [${shared.join(", ")}]\n` +
      `  DB:     [${db.join(", ")}]`,
  );
}

void test("ContextLogRole: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogRole",
    LogRoleSchema.options,
    Object.values(DbContextLogRole),
  );
});

void test("ContextLogRole: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogRole",
    LogRoleEnum.options,
    Object.values(DbContextLogRole),
  );
});

void test("ContextLogSource: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogSource",
    LogSourceSchema.options,
    Object.values(DbContextLogSource),
  );
});

void test("ContextLogSource: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogSource",
    LogSourceEnum.options,
    Object.values(DbContextLogSource),
  );
});

void test("ContextLogType: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogType",
    LogTypeSchema.options,
    Object.values(DbContextLogType),
  );
});

void test("ContextLogType: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogType",
    LogTypeEnum.options,
    Object.values(DbContextLogType),
  );
});

void test("MessageKind: shared matches DB", () => {
  assertEnumSync(
    "MessageKind",
    MessageKindSchema.options,
    Object.values(DbMessageKind),
  );
});

void test("RecipientType: shared matches DB", () => {
  assertEnumSync(
    "RecipientType",
    RecipientTypeEnum.options,
    Object.values(DbRecipientType),
  );
});

void test("AttachmentPurpose: shared matches DB", () => {
  assertEnumSync(
    "AttachmentPurpose",
    AttachmentPurposeEnum.options,
    Object.values(DbAttachmentPurpose),
  );
});

void test("HostType: shared matches DB", () => {
  assertEnumSync("HostType", HostTypeEnum.options, Object.values(DbHostType));
});

void test("ModelType: shared matches DB", () => {
  assertEnumSync(
    "ModelType",
    ModelTypeEnum.options,
    Object.values(DbModelType),
  );
});

void test("CostSource: shared matches DB", () => {
  assertEnumSync(
    "CostSource",
    CostSourceEnum.options,
    Object.values(DbCostSource),
  );
});
