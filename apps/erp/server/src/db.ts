import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";
import { erpDbUrl } from "./dbConfig.js";

const adapter = new PrismaBetterSqlite3({ url: erpDbUrl });
const prisma = new PrismaClient({ adapter });

export default prisma;
