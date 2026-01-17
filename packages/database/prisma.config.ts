import "dotenv/config";
import { defineConfig } from "prisma/config";

// Use placeholder during generation, actual path provided at runtime
const naisysFolder = process.env.NAISYS_FOLDER || "/tmp/naisys";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL || `file:${naisysFolder}/database/naisys.sqlite`,
  },
});
