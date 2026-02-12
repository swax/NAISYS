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
    // Used in dev when we run migrate manually to generate migration scripts
    // Used in prod when self-migrating an existing database
    url: `file:` + join(naisysFolder, "database", `naisys_hub.db`),
  },
});
