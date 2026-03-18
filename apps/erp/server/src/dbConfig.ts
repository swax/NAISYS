import { join } from "path";

export function erpDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "naisys_erp.db");
}

export function erpDbUrl(): string {
  return "file:" + erpDbPath();
}

/** We run migration scripts if this is greater than what's in the schema_version table */
export const ERP_DB_VERSION = 28;
