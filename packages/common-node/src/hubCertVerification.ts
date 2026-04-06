import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Read the hub access key from the local cert file at NAISYS_FOLDER/cert/hub-access-key.
 * Returns undefined if the file does not exist.
 */
export function readHubAccessKeyFile(): string | undefined {
  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const accessKeyPath = join(naisysFolder, "cert", "hub-access-key");
  if (!existsSync(accessKeyPath)) return undefined;
  return readFileSync(accessKeyPath, "utf-8").trim();
}

/**
 * Resolve the hub access key from environment variable or local cert file.
 * Returns undefined if neither is available.
 */
export function resolveHubAccessKey(): string | undefined {
  return process.env.HUB_ACCESS_KEY || readHubAccessKeyFile();
}
