import {
  createPrismaClient,
  supervisorDbPath,
} from "@naisys/supervisor-database";

type SupervisorDb = Awaited<ReturnType<typeof createPrismaClient>>;
let _db: SupervisorDb | undefined;

/** Lazily initialized Prisma client. First access creates the connection. */
const supervisorDb = new Proxy({} as SupervisorDb, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error(
        "supervisorDb accessed before initialization. Ensure migrations have completed first.",
      );
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export async function initSupervisorDb(): Promise<void> {
  if (!_db) {
    _db = await createPrismaClient(supervisorDbPath());
  }
}

export default supervisorDb;
