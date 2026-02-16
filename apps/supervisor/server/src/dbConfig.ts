import { join } from "path";

export function supervisorDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "supervisor.db");
}

export function supervisorDbUrl(): string {
  return "file:" + supervisorDbPath();
}

/** Must match the version in the latest migration's schema_version insert */
export const SUPERVISOR_DB_VERSION = 2;
