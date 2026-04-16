import { join } from "path";

export function hubDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "naisys_hub.db");
}

/** We run migration scripts if this is greater than what's in the schema_version table */
export const HUB_DB_VERSION = 37;
