import { join } from "path";

export function supervisorDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "supervisor.db");
}

export function supervisorDbUrl(): string {
  return "file:" + supervisorDbPath();
}

/** We run migration scripts if this is greater than what's in the schema_version table */
export const SUPERVISOR_DB_VERSION = 10;
