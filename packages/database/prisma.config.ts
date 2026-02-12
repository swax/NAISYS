import "dotenv/config";
import { join } from "path";
import { defineConfig } from "prisma/config";

// Use placeholder during generation, actual path provided at runtime
const naisysFolder = process.env.NAISYS_FOLDER || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.HUB_DATABASE_URL ||
      `file:` + join(naisysFolder, "database", `naisys_hub.db`),
  },
});
