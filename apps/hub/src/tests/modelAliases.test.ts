import { readFileSync } from "node:fs";

import {
  builtInImageModels,
  builtInLlmModels,
  dbFieldsToImageModel,
  dbFieldsToLlmModel,
  findLlmModel,
  imageModelToDbFields,
  llmModelToDbFields,
} from "@naisys/common";
import { createPrismaClient, type PrismaClient } from "@naisys/hub-database";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { migrateBuiltInModelAliases } from "../config/hubModelsService.js";

describe("persisted model alias migration", () => {
  let db: PrismaClient;
  const opus = findLlmModel(builtInLlmModels, "claude_opus")!;

  beforeEach(async () => {
    db = await createPrismaClient(":memory:");
    const migration = readFileSync(
      new URL(
        "../../../../packages/hub-database/prisma/migrations/20260223234341_init/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.$executeRawUnsafe(
      migration.match(/CREATE TABLE "models" \([\s\S]*?\);/)![0],
    );
    await db.$executeRawUnsafe(
      migration.match(/CREATE UNIQUE INDEX "models_key_key"[^;]+;/)![0],
    );
  });
  afterEach(async () => {
    await db?.$disconnect();
  });

  async function insert(
    key: string,
    custom: boolean,
    versionName = "pinned-version",
  ) {
    return db.models.create({
      data: llmModelToDbFields(
        { ...opus, key, aliases: ["my_opus"], versionName, inputCost: 42 },
        true,
        custom,
      ),
    });
  }

  test("removes obsolete default rows so startup can seed canonical defaults", async () => {
    await insert("claude4opus", false);
    await migrateBuiltInModelAliases(db);
    expect(await db.models.count()).toBe(0);
  });

  test("preserves a legacy override and its row identity across repeated upgrades", async () => {
    const old = await insert("claude4opus", true);
    await migrateBuiltInModelAliases(db);
    await migrateBuiltInModelAliases(db);
    const rows = await db.models.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(old.id);
    expect(rows[0].is_custom).toBe(true);
    expect(dbFieldsToLlmModel(rows[0])).toMatchObject({
      key: "claude_opus",
      aliases: ["claude4opus", "my_opus"],
      versionName: "pinned-version",
      inputCost: 42,
    });
  });

  test("a legacy override replaces an uncustomized canonical row", async () => {
    const old = await insert("claude4opus", true);
    await insert("claude_opus", false, "default-version");
    await migrateBuiltInModelAliases(db);
    expect(
      await db.models.findUnique({ where: { key: "claude_opus" } }),
    ).toMatchObject({ id: old.id, version_name: "pinned-version" });
    expect(await db.models.count()).toBe(1);
  });

  test("a canonical override retains compatibility aliases after removing legacy defaults", async () => {
    await insert("claude4opus", false);
    await insert("claude_opus", true);
    await migrateBuiltInModelAliases(db);
    const rows = await db.models.findMany();
    expect(rows).toHaveLength(1);
    expect(dbFieldsToLlmModel(rows[0]).aliases).toContain("claude4opus");
  });

  test("conflicting overrides roll back without deleting either definition", async () => {
    await insert("claude4opus", true, "old-custom");
    await insert("claude_opus", true, "new-custom");
    const before = await db.models.findMany();
    await expect(migrateBuiltInModelAliases(db)).rejects.toThrow(
      "multiple customized definitions",
    );
    expect(await db.models.findMany()).toEqual(before);
  });

  test("migrates customized image models without losing settings or identity", async () => {
    const model = builtInImageModels[0];
    const old = await db.models.create({
      data: imageModelToDbFields(
        { ...model, key: model.aliases![0], aliases: ["my_image"], cost: 42 },
        true,
        true,
      ),
    });
    await db.models.create({ data: imageModelToDbFields(model, true, false) });
    await migrateBuiltInModelAliases(db);
    await migrateBuiltInModelAliases(db);
    const rows = await db.models.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(old.id);
    expect(dbFieldsToImageModel(rows[0])).toMatchObject({
      key: model.key,
      aliases: [...model.aliases!, "my_image"],
      cost: 42,
    });
  });

  test("rejects names owned by a different model type", async () => {
    await db.models.create({
      data: imageModelToDbFields(
        { ...builtInImageModels[0], key: "claude4opus" },
        false,
        true,
      ),
    });
    const before = await db.models.findMany();
    await expect(migrateBuiltInModelAliases(db)).rejects.toThrow(
      "another model type",
    );
    expect(await db.models.findMany()).toEqual(before);
  });
});
