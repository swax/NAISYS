import { Permission as DbPermission } from "@naisys/supervisor-database";
import { PermissionEnum } from "@naisys-supervisor/shared";
import { expect, test } from "vitest";

test("shared PermissionEnum matches database Permission enum", () => {
  const sharedValues = [...PermissionEnum.options].sort();
  const dbValues = Object.values(DbPermission).sort();

  expect(sharedValues, "Permission enums are out of sync").toEqual(dbValues);
});
