import {
  createPrismaClient,
  supervisorDbPath,
} from "@naisys/supervisor-database";

const supervisorDb = await createPrismaClient(supervisorDbPath());

export default supervisorDb;
