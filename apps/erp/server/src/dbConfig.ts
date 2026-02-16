import { join } from "path";

export function erpDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "naisys_erp.db");
}

export function erpDbUrl(): string {
  return "file:" + erpDbPath();
}

/** Must match the version in the latest migration's schema_version insert */
export const ERP_DB_VERSION = 2;
