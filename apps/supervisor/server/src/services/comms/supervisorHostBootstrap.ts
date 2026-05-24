import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hubDb } from "../../database/hubDb.js";

const SUPERVISOR_HOST_NAME = "SUPERVISOR";

function certDir(): string {
  return join(process.env.NAISYS_FOLDER || "", "cert");
}

function certPath(): string {
  return join(certDir(), "integrated-supervisor-access-key");
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Ensure the SUPERVISOR host row + cached cert file are in sync. Regenerates
 * on drift (DB restore, edited file) instead of letting handshake fail.
 */
export async function bootstrapSupervisorHost(): Promise<void> {
  const filePath = certPath();
  const host = await hubDb.hosts.findUnique({
    where: { name: SUPERVISOR_HOST_NAME },
  });

  if (host && host.access_key_hash && existsSync(filePath)) {
    const cached = readFileSync(filePath, "utf-8").trim();
    if (cached && hashKey(cached) === host.access_key_hash) {
      return;
    }
    console.log(
      "[Supervisor:HostKey] Cached supervisor key does not match stored hash — regenerating",
    );
  }

  const plaintext = randomBytes(32).toString("hex");
  const hash = hashKey(plaintext);

  mkdirSync(certDir(), { recursive: true });
  writeFileSync(filePath, plaintext, { mode: 0o600 });

  if (host) {
    await hubDb.hosts.update({
      where: { id: host.id },
      data: { access_key_hash: hash, host_type: "supervisor" },
    });
    console.log(
      "[Supervisor:HostKey] Re-keyed supervisor host (cached plaintext at NAISYS_FOLDER/cert/integrated-supervisor-access-key)",
    );
  } else {
    await hubDb.hosts.create({
      data: {
        name: SUPERVISOR_HOST_NAME,
        host_type: "supervisor",
        access_key_hash: hash,
      },
    });
    console.log(
      "[Supervisor:HostKey] Created supervisor host with fresh access key (NAISYS_FOLDER/cert/integrated-supervisor-access-key)",
    );
  }
}

export function readSupervisorAccessKey(): string | undefined {
  const filePath = certPath();
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, "utf-8").trim();
}
