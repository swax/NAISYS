import {
  createPrismaClient,
  supervisorDbPath,
} from "@naisys/supervisor-database";

const supervisorDb = createPrismaClient(supervisorDbPath());

export default supervisorDb;
