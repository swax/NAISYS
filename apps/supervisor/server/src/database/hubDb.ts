import { createPrismaClient } from "@naisys/hub-database";
import path from "path";
import { env } from "process";

export function getNaisysDatabasePath(): string {
  if (!env.NAISYS_FOLDER) {
    throw new Error("NAISYS_FOLDER environment variable is not set.");
  }

  const dbFilename = "naisys_hub.db";
  return path.join(env.NAISYS_FOLDER, "database", dbFilename);
}

type HubDb = Awaited<ReturnType<typeof createPrismaClient>>;
let _db: HubDb | undefined;

/** Lazily initialized Prisma client. First access creates the connection. */
export const hubDb: HubDb = new Proxy({} as HubDb, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error(
        "hubDb accessed before initialization. Ensure migrations have completed first.",
      );
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export async function initHubDb(): Promise<void> {
  if (!_db) {
    _db = await createPrismaClient(getNaisysDatabasePath());
  }
}
