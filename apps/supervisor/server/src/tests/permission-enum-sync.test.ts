import assert from "node:assert/strict";
import { test } from "node:test";

import { Permission as DbPermission } from "@naisys/supervisor-database";
import { PermissionEnum } from "@naisys-supervisor/shared";

test("shared PermissionEnum matches database Permission enum", () => {
  const sharedValues = [...PermissionEnum.options].sort();
  const dbValues = Object.values(DbPermission).sort();

  assert.deepStrictEqual(
    sharedValues,
    dbValues,
    `Permission enums are out of sync.\n` +
      `  Shared: [${sharedValues.join(", ")}]\n` +
      `  DB:     [${dbValues.join(", ")}]`,
  );
});
