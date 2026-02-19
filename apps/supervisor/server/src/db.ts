import {
  createPrismaClient,
  supervisorDbPath,
} from "@naisys/supervisor-database";

const prisma = createPrismaClient(supervisorDbPath());

export default prisma;
