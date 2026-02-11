import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";
import { join } from "path";

const naisysFolder = process.env.NAISYS_FOLDER || "";

const dbPath =
  process.env.ERP_DATABASE_URL ||
  `file:` + join(naisysFolder, "database", "naisys_erp.db");

const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

export default prisma;
