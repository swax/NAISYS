import { join } from "path";

export function hubDbPath(): string {
  return join(process.env.NAISYS_FOLDER || "", "database", "naisys_hub.db");
}
