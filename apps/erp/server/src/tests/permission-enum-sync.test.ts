import assert from "node:assert/strict";
import { test } from "node:test";

import { ErpPermission as DbErpPermission } from "../generated/prisma/enums.js";
import { ErpPermissionEnum } from "@naisys-erp/shared";

test("shared ErpPermissionEnum matches database ErpPermission enum", () => {
  const sharedValues = [...ErpPermissionEnum.options].sort();
  const dbValues = Object.values(DbErpPermission).sort();

  assert.deepStrictEqual(
    sharedValues,
    dbValues,
    `ErpPermission enums are out of sync.\n` +
      `  Shared: [${sharedValues.join(", ")}]\n` +
      `  DB:     [${dbValues.join(", ")}]`,
  );
});
