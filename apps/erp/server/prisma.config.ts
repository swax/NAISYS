import "dotenv/config";
import path from "path";
import { defineConfig } from "prisma/config";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.ERP_DATABASE_URL ||
      `file:${path.join(__dirname, "prisma", "erp.db")}`,
  },
});
