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
} from "@naisys/supervisor-shared";
import { expect, test } from "vitest";

function assertEnumSync(
  name: string,
  zodOptions: readonly string[],
  dbValues: string[],
) {
  const shared = [...zodOptions].sort();
  const db = [...dbValues].sort();
  expect(shared, `${name} enums are out of sync`).toEqual(db);
}

test("ContextLogRole: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogRole",
    LogRoleSchema.options,
    Object.values(DbContextLogRole),
  );
});

test("ContextLogRole: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogRole",
    LogRoleEnum.options,
    Object.values(DbContextLogRole),
  );
});

test("ContextLogSource: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogSource",
    LogSourceSchema.options,
    Object.values(DbContextLogSource),
  );
});

test("ContextLogSource: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogSource",
    LogSourceEnum.options,
    Object.values(DbContextLogSource),
  );
});

test("ContextLogType: supervisor/shared matches DB", () => {
  assertEnumSync(
    "ContextLogType",
    LogTypeSchema.options,
    Object.values(DbContextLogType),
  );
});

test("ContextLogType: hub-protocol matches DB", () => {
  assertEnumSync(
    "ContextLogType",
    LogTypeEnum.options,
    Object.values(DbContextLogType),
  );
});

test("MessageKind: shared matches DB", () => {
  assertEnumSync(
    "MessageKind",
    MessageKindSchema.options,
    Object.values(DbMessageKind),
  );
});

test("RecipientType: shared matches DB", () => {
  assertEnumSync(
    "RecipientType",
    RecipientTypeEnum.options,
    Object.values(DbRecipientType),
  );
});

test("AttachmentPurpose: shared matches DB", () => {
  assertEnumSync(
    "AttachmentPurpose",
    AttachmentPurposeEnum.options,
    Object.values(DbAttachmentPurpose),
  );
});

test("HostType: shared matches DB", () => {
  assertEnumSync("HostType", HostTypeEnum.options, Object.values(DbHostType));
});

test("ModelType: shared matches DB", () => {
  assertEnumSync(
    "ModelType",
    ModelTypeEnum.options,
    Object.values(DbModelType),
  );
});

test("CostSource: shared matches DB", () => {
  assertEnumSync(
    "CostSource",
    CostSourceEnum.options,
    Object.values(DbCostSource),
  );
});
