import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deployPrismaMigrations } from "@naisys/common-node";
import Database from "better-sqlite3";
import { expect, test } from "vitest";

import { ERP_DB_VERSION } from "../database/dbConfig.js";

test("startup migrates an existing version 46 database to support deferred retries", async () => {
  const serverDir = fileURLToPath(new URL("../../", import.meta.url));
  const testRoot = path.join(serverDir, ".test-naisys");
  await mkdir(testRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(testRoot, "migration-upgrade-"));
  const migrationName = "20260919062000_operation_retry_not_before";
  const wakeMigrationName = "20260919090000_retry_manager_wakeup";
  const sourcePrisma = path.join(serverDir, "prisma");
  const targetPrisma = path.join(fixture, "prisma");
  const databasePath = path.join(fixture, "database", "naisys_erp.db");
  let passed = false;
  try {
    await mkdir(path.dirname(databasePath), { recursive: true });
    await mkdir(path.join(targetPrisma, "migrations"), { recursive: true });
    await cp(
      path.join(serverDir, "prisma.config.ts"),
      path.join(fixture, "prisma.config.ts"),
    );
    await cp(
      path.join(sourcePrisma, "schema.prisma"),
      path.join(targetPrisma, "schema.prisma"),
    );
    for (const entry of await readdir(path.join(sourcePrisma, "migrations"))) {
      if (entry !== migrationName && entry !== wakeMigrationName) {
        await cp(
          path.join(sourcePrisma, "migrations", entry),
          path.join(targetPrisma, "migrations", entry),
          { recursive: true },
        );
      }
    }
    const options = {
      packageDir: fixture,
      databasePath,
      envOverrides: { NAISYS_FOLDER: fixture },
    };
    await deployPrismaMigrations({ ...options, expectedVersion: 46 });
    let db = new Database(databasePath);
    expect(
      db.prepare("SELECT version FROM schema_version WHERE id = 1").get(),
    ).toEqual({ version: 46 });
    expect(db.prepare("PRAGMA table_info(operation_runs)").all()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "retry_not_before" }),
      ]),
    );
    db.close();

    await cp(
      path.join(sourcePrisma, "migrations", migrationName),
      path.join(targetPrisma, "migrations", migrationName),
      { recursive: true },
    );
    // Use the real startup version, so a missing version bump reproduces the bug.
    await cp(
      path.join(sourcePrisma, "migrations", wakeMigrationName),
      path.join(targetPrisma, "migrations", wakeMigrationName),
      { recursive: true },
    );
    await deployPrismaMigrations({
      ...options,
      expectedVersion: ERP_DB_VERSION,
    });
    db = new Database(databasePath);
    try {
      expect(db.prepare("PRAGMA table_info(operation_runs)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "retry_not_before" }),
          expect.objectContaining({ name: "retry_manager_id" }),
          expect.objectContaining({ name: "retry_wake_sent_at" }),
        ]),
      );
      expect(
        db.prepare("SELECT version FROM schema_version WHERE id = 1").get(),
      ).toEqual({ version: ERP_DB_VERSION });
      expect(db.prepare("PRAGMA index_list(operation_runs)").all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "operation_runs_retry_not_before_idx",
          }),
        ]),
      );
    } finally {
      db.close();
    }
    passed = true;
  } finally {
    const relative = path.relative(testRoot, fixture);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        "Refusing to remove a migration fixture outside the test directory",
      );
    }
    // Keep a failed fixture for diagnosis; do not mask migration failures with
    // a Windows cleanup error while Prisma's engine is still shutting down.
    if (passed) {
      await rm(fixture, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
}, 60000);
