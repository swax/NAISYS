import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Loads existing hub access key from NAISYS_FOLDER/cert/hub-access-key
 * or generates a new random key. The access key is used by clients to
 * authenticate their Socket.IO connections to the hub.
 */
export function loadOrCreateAccessKey(): string {
  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const certDir = join(naisysFolder, "cert");
  const accessKeyPath = join(certDir, "hub-access-key");

  if (existsSync(accessKeyPath)) {
    return readFileSync(accessKeyPath, "utf-8").trim();
  }

  mkdirSync(certDir, { recursive: true });

  const accessKey = randomBytes(32).toString("hex");
  writeFileSync(accessKeyPath, accessKey, { mode: 0o600 });

  return accessKey;
}

/**
 * Rotates the hub access key by generating a new random secret.
 * Writes the new key to disk and returns it.
 */
export function rotateAccessKey(): string {
  const naisysFolder = process.env.NAISYS_FOLDER || "";
  const accessKeyPath = join(naisysFolder, "cert", "hub-access-key");

  const newAccessKey = randomBytes(32).toString("hex");
  writeFileSync(accessKeyPath, newAccessKey, { mode: 0o600 });

  return newAccessKey;
}
